import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
} from './device-token.schemas';

const webKeys = {
  p256dh: 'BM9bF3xL0qKp'.repeat(7),
  auth: 'kQ9sL2mN4pR7tV0wX3yZ5a',
};

describe('registerDeviceTokenSchema', () => {
  it('keeps accepting the mobile body unchanged (Expo token + platform)', () => {
    const parsed = registerDeviceTokenSchema.parse({
      platform: 'ANDROID',
      expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    });
    expect(parsed).toEqual({
      platform: 'ANDROID',
      expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    });
  });

  it('accepts a browser subscription: endpoint plus the RFC 8291 keys', () => {
    const parsed = registerDeviceTokenSchema.parse({
      platform: 'WEB',
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: webKeys,
    });
    expect(parsed).toEqual({
      platform: 'WEB',
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: webKeys,
    });
  });

  it('rejects a browser subscription without its encryption keys', () => {
    const result = registerDeviceTokenSchema.safeParse({
      platform: 'WEB',
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an endpoint outside the push-service allowlist (SSRF guard)', () => {
    const result = registerDeviceTokenSchema.safeParse({
      platform: 'WEB',
      endpoint: 'https://169.254.169.254/latest/meta-data',
      keys: webKeys,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an Expo token shape sent under the WEB platform, and vice versa', () => {
    expect(
      registerDeviceTokenSchema.safeParse({
        platform: 'WEB',
        expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      }).success,
    ).toBe(false);
    expect(
      registerDeviceTokenSchema.safeParse({
        platform: 'IOS',
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: webKeys,
      }).success,
    ).toBe(false);
  });
});

describe('unregisterDeviceTokenSchema', () => {
  it('accepts the name each client knows its destination by', () => {
    expect(
      unregisterDeviceTokenSchema.parse({ expoPushToken: 'ExponentPushToken[abc]' }),
    ).toEqual({ expoPushToken: 'ExponentPushToken[abc]' });
    expect(
      unregisterDeviceTokenSchema.parse({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      }),
    ).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' });
  });

  it('rejects an empty body', () => {
    expect(unregisterDeviceTokenSchema.safeParse({}).success).toBe(false);
  });
});
