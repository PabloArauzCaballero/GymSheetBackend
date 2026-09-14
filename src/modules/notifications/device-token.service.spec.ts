import { ServiceUnavailableException } from '@nestjs/common';
import { PushDispatcherService } from './delivery/push-dispatcher.service';
import { DevicePlatform } from './device-token.model';
import { DeviceTokenRepository } from './device-token.repository';
import { DeviceTokenService } from './device-token.service';

function build(supported: DevicePlatform[]) {
  const repository = {
    upsert: jest.fn(async () => undefined),
    deactivate: jest.fn(async () => undefined),
  } as unknown as DeviceTokenRepository & { upsert: jest.Mock; deactivate: jest.Mock };
  const push = {
    supports: (platform: DevicePlatform) => supported.includes(platform),
  } as unknown as PushDispatcherService;
  return { repository, service: new DeviceTokenService(repository, push) };
}

describe('DeviceTokenService', () => {
  it('stores an Expo token as the destination, with no encryption keys', async () => {
    const { repository, service } = build([DevicePlatform.ANDROID]);

    await service.register('user-1', {
      platform: DevicePlatform.ANDROID,
      expoPushToken: 'ExponentPushToken[abc]',
    });

    expect(repository.upsert).toHaveBeenCalledWith('user-1', {
      platform: DevicePlatform.ANDROID,
      pushToken: 'ExponentPushToken[abc]',
      p256dh: null,
      auth: null,
    });
  });

  it('stores a browser subscription with its endpoint as the destination and its keys', async () => {
    const { repository, service } = build([DevicePlatform.WEB]);

    await service.register('user-1', {
      platform: DevicePlatform.WEB,
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    });

    expect(repository.upsert).toHaveBeenCalledWith('user-1', {
      platform: DevicePlatform.WEB,
      pushToken: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
    });
  });

  it('refuses to store a subscription for a platform this deployment cannot deliver to', async () => {
    const { repository, service } = build([DevicePlatform.ANDROID]);

    await expect(
      service.register('user-1', {
        platform: DevicePlatform.WEB,
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('unregisters by whichever name the client used for its destination', async () => {
    const { repository, service } = build([DevicePlatform.ANDROID, DevicePlatform.WEB]);

    await service.unregister('user-1', { expoPushToken: 'ExponentPushToken[abc]' });
    await service.unregister('user-1', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    });

    expect(repository.deactivate).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'ExponentPushToken[abc]',
    );
    expect(repository.deactivate).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'https://fcm.googleapis.com/fcm/send/abc',
    );
  });

  it('only exposes the public key when web push is actually routable', () => {
    expect(build([DevicePlatform.ANDROID]).service.webPushConfig()).toEqual({
      enabled: false,
      publicKey: null,
    });
    expect(build([DevicePlatform.WEB]).service.webPushConfig().enabled).toBe(true);
  });
});
