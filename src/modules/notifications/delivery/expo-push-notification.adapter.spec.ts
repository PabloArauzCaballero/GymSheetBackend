import { ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../../config/env';
import { DeviceTokenRepository } from '../device-token.repository';
import { ExpoPushNotificationAdapter } from './expo-push-notification.adapter';
import { NotificationDeliveryRequest } from './notification-delivery.adapter';

const request: NotificationDeliveryRequest = {
  notificationId: '00000000-0000-4000-8000-000000000001',
  recipientUserId: '00000000-0000-4000-8000-0000000000aa',
  subject: 'Camila',
  body: '¿Entrenamos mañana?',
  daysRemaining: null,
  idempotencyKey: 'delivery:chat.message:m1:u1',
};

function tokenRow(expoPushToken: string) {
  return { expoPushToken } as unknown as Awaited<
    ReturnType<DeviceTokenRepository['listActiveForUser']>
  >[number];
}

function createAdapter(overrides: Partial<DeviceTokenRepository> = {}) {
  const repository = {
    listActiveForUser: jest.fn().mockResolvedValue([tokenRow('ExponentPushToken[aaa]')]),
    revokeTokens: jest.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as DeviceTokenRepository;
  return { adapter: new ExpoPushNotificationAdapter(repository), repository };
}

/** El cuerpo que se le mandó a Expo, ya como texto. */
function bodySentOn(call: [string, RequestInit]): Array<Record<string, unknown>> {
  const [, init] = call;
  return JSON.parse(typeof init.body === 'string' ? init.body : '[]') as Array<
    Record<string, unknown>
  >;
}

function respondWith(payload: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  });
}

const pushEnabled = env as unknown as { PUSH_NOTIFICATIONS_ENABLED: boolean };
const originalFetch = global.fetch;
let originalEnabled: boolean;

beforeAll(() => {
  originalEnabled = pushEnabled.PUSH_NOTIFICATIONS_ENABLED;
});

beforeEach(() => {
  pushEnabled.PUSH_NOTIFICATIONS_ENABLED = true;
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  pushEnabled.PUSH_NOTIFICATIONS_ENABLED = originalEnabled;
});

describe('ExpoPushNotificationAdapter', () => {
  it('refuses to deliver while push is switched off', async () => {
    pushEnabled.PUSH_NOTIFICATIONS_ENABLED = false;
    const { adapter } = createAdapter();
    await expect(adapter.deliver(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not call Expo when the recipient has no device', async () => {
    const fetchMock = respondWith({ data: [] });
    global.fetch = fetchMock;
    const { adapter } = createAdapter({
      listActiveForUser: jest.fn().mockResolvedValue([]),
    });

    const result = await adapter.deliver(request);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.responseCode).toBe('NO_ACTIVE_DEVICE');
    expect(result.provider).toBe('EXPO_PUSH');
  });

  it('sends one message per active device and reports the ticket', async () => {
    const fetchMock = respondWith({
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'ok', id: 'ticket-2' },
      ],
    });
    global.fetch = fetchMock;
    const { adapter } = createAdapter({
      listActiveForUser: jest
        .fn()
        .mockResolvedValue([
          tokenRow('ExponentPushToken[aaa]'),
          tokenRow('ExponentPushToken[bbb]'),
        ]),
    });

    const result = await adapter.deliver(request);

    const sent = bodySentOn(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: 'ExponentPushToken[aaa]',
      title: 'Camila',
      body: '¿Entrenamos mañana?',
      data: { notificationId: request.notificationId },
    });
    expect(result.providerMessageId).toBe('ticket-1');
    expect(result.responseCode).toBe('ACCEPTED_2');
  });

  it('revokes the tokens Expo reports as no longer registered', async () => {
    global.fetch = respondWith({
      data: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: 'ticket-2' },
      ],
    });
    const { adapter, repository } = createAdapter({
      listActiveForUser: jest
        .fn()
        .mockResolvedValue([
          tokenRow('ExponentPushToken[dead]'),
          tokenRow('ExponentPushToken[alive]'),
        ]),
    });

    const result = await adapter.deliver(request);

    expect(repository.revokeTokens).toHaveBeenCalledWith([
      'ExponentPushToken[dead]',
    ]);
    expect(result.responseCode).toBe('ACCEPTED_1');
  });

  it('gives up quietly when every device is simply gone', async () => {
    global.fetch = respondWith({
      data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
    });
    const { adapter } = createAdapter();

    // Reintentar no va a resucitar un dispositivo desinstalado: el trabajo
    // termina en vez de arrastrarse hasta la cola de muertos.
    await expect(adapter.deliver(request)).resolves.toMatchObject({
      responseCode: 'NO_ACTIVE_DEVICE',
    });
  });

  it('fails so the job retries when the failure can change', async () => {
    global.fetch = respondWith({
      data: [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
    });
    const { adapter } = createAdapter();

    await expect(adapter.deliver(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails when Expo rejects the whole request', async () => {
    global.fetch = respondWith({
      errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }],
    });
    const { adapter } = createAdapter();

    await expect(adapter.deliver(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails on a non-2xx answer instead of pretending it was delivered', async () => {
    global.fetch = respondWith({}, false, 502);
    const { adapter } = createAdapter();

    await expect(adapter.deliver(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('splits into requests of at most 100 messages', async () => {
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const batch = bodySentOn([url, init]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: batch.map((_message, index) => ({ status: 'ok', id: `t-${index}` })),
        }),
      };
    });
    global.fetch = fetchMock;
    const tokens = Array.from({ length: 101 }, (_value, index) =>
      tokenRow(`ExponentPushToken[d${index}]`),
    );
    const { adapter } = createAdapter({
      listActiveForUser: jest.fn().mockResolvedValue(tokens),
    });

    const result = await adapter.deliver(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      (call) => bodySentOn(call as [string, RequestInit]).length,
    );
    expect(sizes).toEqual([100, 1]);
    expect(result.responseCode).toBe('ACCEPTED_101');
  });
});
