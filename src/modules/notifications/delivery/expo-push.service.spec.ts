import { DeviceTokenRepository } from '../device-token.repository';
import { ExpoPushService } from './expo-push.service';

const userId = '00000000-0000-4000-8000-0000000000aa';
const notification = { title: 'Camila', body: '¿Entrenamos mañana?' };

/** El cuerpo que se le mandó a Expo, ya como texto. */
function bodySentOn(call: [string, RequestInit]): Array<Record<string, unknown>> {
  const [, init] = call;
  return JSON.parse(typeof init.body === 'string' ? init.body : '[]') as Array<
    Record<string, unknown>
  >;
}

function createService(overrides: Partial<DeviceTokenRepository> = {}) {
  const deviceTokens = {
    findActiveTokens: jest.fn().mockResolvedValue(['ExponentPushToken[aaa]']),
    deactivateByToken: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DeviceTokenRepository;
  return { service: new ExpoPushService(deviceTokens), deviceTokens };
}

function respondWith(payload: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({ ok, status, json: async () => payload });
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('ExpoPushService', () => {
  it('no llama a Expo cuando la persona no tiene ningún dispositivo', async () => {
    const fetchMock = respondWith({ data: [] });
    global.fetch = fetchMock;
    const { service } = createService({
      findActiveTokens: jest.fn().mockResolvedValue([]),
    });

    await expect(service.sendToUser(userId, notification)).resolves.toEqual({
      sent: 0,
      deactivated: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda un mensaje por dispositivo activo, con título y cuerpo', async () => {
    const fetchMock = respondWith({
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'ok', id: 'ticket-2' },
      ],
    });
    global.fetch = fetchMock;
    const { service } = createService({
      findActiveTokens: jest
        .fn()
        .mockResolvedValue(['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]']),
    });

    const result = await service.sendToUser(userId, notification);

    const sent = bodySentOn(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: 'ExponentPushToken[aaa]',
      title: 'Camila',
      body: '¿Entrenamos mañana?',
    });
    expect(result).toEqual({ sent: 2, deactivated: 0 });
  });

  it('desactiva el token que Expo declara no registrado y sigue con el resto', async () => {
    global.fetch = respondWith({
      data: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: 'ticket-2' },
      ],
    });
    const { service, deviceTokens } = createService({
      findActiveTokens: jest
        .fn()
        .mockResolvedValue(['ExponentPushToken[muerto]', 'ExponentPushToken[vivo]']),
    });

    const result = await service.sendToUser(userId, notification);

    expect(deviceTokens.deactivateByToken).toHaveBeenCalledWith('ExponentPushToken[muerto]');
    expect(deviceTokens.deactivateByToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, deactivated: 1 });
  });

  it('no desactiva por un error que puede dejar de darse', async () => {
    global.fetch = respondWith({
      data: [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
    });
    const { service, deviceTokens } = createService();

    const result = await service.sendToUser(userId, notification);

    expect(deviceTokens.deactivateByToken).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, deactivated: 0 });
  });

  it('un 5xx de Expo no tumba a quien llama', async () => {
    global.fetch = respondWith({}, false, 502);
    const { service } = createService();

    // Best-effort por diseño: el chat ya escribió y emitió el mensaje.
    await expect(service.sendToUser(userId, notification)).resolves.toEqual({
      sent: 0,
      deactivated: 0,
    });
  });

  it('una red caída tampoco lanza', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { service } = createService();

    await expect(service.sendToUser(userId, notification)).resolves.toEqual({
      sent: 0,
      deactivated: 0,
    });
  });

  it('trocea en peticiones de como mucho 100 mensajes', async () => {
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
    const tokens = Array.from({ length: 101 }, (_value, index) => `ExponentPushToken[d${index}]`);
    const { service } = createService({
      findActiveTokens: jest.fn().mockResolvedValue(tokens),
    });

    const result = await service.sendToUser(userId, notification);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      (call) => bodySentOn(call as [string, RequestInit]).length,
    );
    expect(sizes).toEqual([100, 1]);
    expect(result.sent).toBe(101);
  });
});
