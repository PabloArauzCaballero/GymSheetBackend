import { DevicePlatform } from '../device-token.model';
import { createWebPushTransport } from './push-transport.factory';

describe('createWebPushTransport', () => {
  const vapid = {
    subject: 'mailto:avisos@gymsheet.test',
    publicKey: 'BPublicKeyForTestsOnly',
    privateKey: 'PrivateKeyForTestsOnly',
    allowedHosts: ['fcm.googleapis.com'],
    timeoutMs: 10_000,
    ttlSeconds: 86_400,
  };

  it('returns no transport when web push is explicitly disabled', () => {
    expect(createWebPushTransport({ ...vapid, transport: 'DISABLED' })).toBeNull();
  });

  it('builds a transport that only claims the WEB platform', () => {
    const transport = createWebPushTransport({ ...vapid, transport: 'VAPID' });
    expect(transport?.name).toBe('WEB_PUSH');
    expect(transport?.platforms).toEqual([DevicePlatform.WEB]);
  });

  it('refuses to boot when VAPID is requested without keys, naming what is missing', () => {
    expect(() =>
      createWebPushTransport({
        ...vapid,
        transport: 'VAPID',
        publicKey: undefined,
        privateKey: undefined,
      }),
    ).toThrow(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY/u);
  });

  it('refuses to boot without a subject (RFC 8292 requires a contact)', () => {
    expect(() =>
      createWebPushTransport({ ...vapid, transport: 'VAPID', subject: undefined }),
    ).toThrow(/VAPID_SUBJECT/u);
  });

  it('refuses to boot with an empty push-service allowlist', () => {
    expect(() =>
      createWebPushTransport({ ...vapid, transport: 'VAPID', allowedHosts: [] }),
    ).toThrow(/WEB_PUSH_ALLOWED_HOSTS/u);
  });
});
