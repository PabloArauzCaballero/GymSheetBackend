jest.mock('web-push', () => ({
  __esModule: true,
  sendNotification: jest.fn(),
  // La clase real no sirve aquí (el módulo está simulado) pero `instanceof` sí
  // tiene que funcionar: el adaptador distingue un rechazo del servicio de push
  // de un fallo de red por el tipo del error.
  WebPushError: class WebPushError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
      this.name = 'WebPushError';
    }
  },
}));

import { WebPushError, sendNotification } from 'web-push';
import { DevicePlatform } from '../device-token.model';
import { PushTarget } from './push.transport';
import { VapidWebPushTransport } from './vapid-web-push.transport';

const sendNotificationMock = sendNotification as jest.MockedFunction<typeof sendNotification>;

function buildTransport() {
  return new VapidWebPushTransport({
    subject: 'mailto:avisos@gymsheet.test',
    publicKey: 'public-key',
    privateKey: 'private-key',
    allowedHosts: ['fcm.googleapis.com'],
    timeoutMs: 5_000,
    ttlSeconds: 3_600,
  });
}

const target: PushTarget = {
  id: 'target-1',
  platform: DevicePlatform.WEB,
  pushToken: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
};

const message = { title: 'Tu membresía vence', body: 'Quedan 3 días.', url: '/notifications' };

describe('VapidWebPushTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('encrypts one request per subscription and reports delivery', async () => {
    sendNotificationMock.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const outcomes = await buildTransport().send([target, { ...target, id: 'target-2' }], message);

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const [subscription, payload, options] = sendNotificationMock.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: target.pushToken,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    });
    expect(JSON.parse(payload as string)).toEqual({
      title: 'Tu membresía vence',
      body: 'Quedan 3 días.',
      url: '/notifications',
    });
    expect(options).toMatchObject({ TTL: 3_600, timeout: 5_000, contentEncoding: 'aes128gcm' });
    expect(outcomes).toEqual([
      { targetId: 'target-1', status: 'DELIVERED' },
      { targetId: 'target-2', status: 'DELIVERED' },
    ]);
  });

  it('marks a subscription GONE on 404/410 so the worker stops retrying it', async () => {
    sendNotificationMock.mockRejectedValueOnce(new WebPushError('gone', 410, {}, '', ''));
    await expect(buildTransport().send([target], message)).resolves.toEqual([
      { targetId: 'target-1', status: 'GONE' },
    ]);

    sendNotificationMock.mockRejectedValueOnce(new WebPushError('missing', 404, {}, '', ''));
    await expect(buildTransport().send([target], message)).resolves.toEqual([
      { targetId: 'target-1', status: 'GONE' },
    ]);
  });

  it('treats throttling and service errors as transient, never as a reason to unsubscribe', async () => {
    sendNotificationMock.mockRejectedValueOnce(new WebPushError('too many', 429, {}, '', ''));
    await expect(buildTransport().send([target], message)).resolves.toEqual([
      { targetId: 'target-1', status: 'FAILED' },
    ]);

    sendNotificationMock.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(buildTransport().send([target], message)).resolves.toEqual([
      { targetId: 'target-1', status: 'FAILED' },
    ]);
  });

  it('never opens a connection to an endpoint outside the allowlist', async () => {
    const outcomes = await buildTransport().send(
      [{ ...target, pushToken: 'https://169.254.169.254/latest' }],
      message,
    );
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ targetId: 'target-1', status: 'FAILED' }]);
  });

  it('retires a row that lost its encryption keys instead of sending an undecryptable body', async () => {
    const outcomes = await buildTransport().send([{ ...target, p256dh: null }], message);
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ targetId: 'target-1', status: 'GONE' }]);
  });
});
