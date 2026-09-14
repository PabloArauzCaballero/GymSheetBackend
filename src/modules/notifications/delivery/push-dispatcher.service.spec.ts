import { DevicePlatform } from '../device-token.model';
import { DeviceTokenRepository } from '../device-token.repository';
import { PushDispatcherService } from './push-dispatcher.service';
import {
  PushDeliveryOutcome,
  PushMessage,
  PushTarget,
  PushTransport,
} from './push.transport';

function fakeTransport(
  name: string,
  platforms: DevicePlatform[],
  outcome: PushDeliveryOutcome['status'] = 'DELIVERED',
): PushTransport & { send: jest.Mock } {
  return {
    name,
    platforms,
    send: jest.fn(
      async (targets: readonly PushTarget[], _message: PushMessage) =>
        targets.map((target) => ({ targetId: target.id, status: outcome })),
    ),
  };
}

function fakeRepository(targets: PushTarget[]) {
  return {
    findActiveTargets: jest.fn(async () => targets),
    deactivateById: jest.fn(async () => undefined),
  } as unknown as DeviceTokenRepository & {
    findActiveTargets: jest.Mock;
    deactivateById: jest.Mock;
  };
}

const phone: PushTarget = {
  id: 'phone',
  platform: DevicePlatform.ANDROID,
  pushToken: 'ExponentPushToken[abc]',
  p256dh: null,
  auth: null,
};
const browser: PushTarget = {
  id: 'browser',
  platform: DevicePlatform.WEB,
  pushToken: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'p256dh',
  auth: 'auth',
};
const message: PushMessage = { title: 'Aviso', body: 'Cuerpo', url: '/notifications' };

describe('PushDispatcherService', () => {
  it('routes each device by ITS platform, so phone and browser both ring', async () => {
    const expo = fakeTransport('EXPO', [DevicePlatform.ANDROID, DevicePlatform.IOS]);
    const web = fakeTransport('WEB_PUSH', [DevicePlatform.WEB]);
    const repository = fakeRepository([phone, browser]);
    const dispatcher = new PushDispatcherService([expo, web], repository);

    const result = await dispatcher.sendToUser('user-1', message);

    expect(expo.send).toHaveBeenCalledWith([phone], message);
    expect(web.send).toHaveBeenCalledWith([browser], message);
    expect(result).toEqual({ delivered: 2, deactivated: 0, skipped: 0 });
  });

  it('groups every device of one platform into a single transport call', async () => {
    const expo = fakeTransport('EXPO', [DevicePlatform.ANDROID, DevicePlatform.IOS]);
    const tablet: PushTarget = { ...phone, id: 'tablet', pushToken: 'ExponentPushToken[def]' };
    const iphone: PushTarget = {
      ...phone,
      id: 'iphone',
      platform: DevicePlatform.IOS,
      pushToken: 'ExponentPushToken[ghi]',
    };
    const dispatcher = new PushDispatcherService(
      [expo],
      fakeRepository([phone, tablet, iphone]),
    );

    await dispatcher.sendToUser('user-1', message);

    expect(expo.send).toHaveBeenCalledTimes(1);
    expect(expo.send.mock.calls[0][0]).toEqual([phone, tablet, iphone]);
  });

  it('skips devices whose platform has no transport instead of failing the send', async () => {
    const expo = fakeTransport('EXPO', [DevicePlatform.ANDROID, DevicePlatform.IOS]);
    const repository = fakeRepository([phone, browser]);
    const dispatcher = new PushDispatcherService([expo], repository);

    const result = await dispatcher.sendToUser('user-1', message);

    expect(expo.send).toHaveBeenCalledWith([phone], message);
    expect(result).toEqual({ delivered: 1, deactivated: 0, skipped: 1 });
    expect(repository.deactivateById).not.toHaveBeenCalled();
  });

  it('deactivates only the devices the push service reported as gone', async () => {
    const expo = fakeTransport('EXPO', [DevicePlatform.ANDROID, DevicePlatform.IOS], 'GONE');
    const web = fakeTransport('WEB_PUSH', [DevicePlatform.WEB], 'FAILED');
    const repository = fakeRepository([phone, browser]);
    const dispatcher = new PushDispatcherService([expo, web], repository);

    const result = await dispatcher.sendToUser('user-1', message);

    expect(repository.deactivateById).toHaveBeenCalledTimes(1);
    expect(repository.deactivateById).toHaveBeenCalledWith('phone');
    expect(result).toEqual({ delivered: 0, deactivated: 1, skipped: 0 });
  });

  it('reports which platforms are routable so the API can refuse a pointless subscription', () => {
    const expo = fakeTransport('EXPO', [DevicePlatform.ANDROID, DevicePlatform.IOS]);
    const dispatcher = new PushDispatcherService([expo], fakeRepository([]));

    expect(dispatcher.supports(DevicePlatform.ANDROID)).toBe(true);
    expect(dispatcher.supports(DevicePlatform.WEB)).toBe(false);
  });

  it('does not touch any transport when the user has no registered device', async () => {
    const expo = fakeTransport('EXPO', [DevicePlatform.ANDROID, DevicePlatform.IOS]);
    const dispatcher = new PushDispatcherService([expo], fakeRepository([]));

    await expect(dispatcher.sendToUser('user-1', message)).resolves.toEqual({
      delivered: 0,
      deactivated: 0,
      skipped: 0,
    });
    expect(expo.send).not.toHaveBeenCalled();
  });

  it('refuses an ambiguous routing table (two transports for one platform)', () => {
    const first = fakeTransport('EXPO', [DevicePlatform.ANDROID]);
    const second = fakeTransport('OTHER', [DevicePlatform.ANDROID]);

    expect(() => new PushDispatcherService([first, second], fakeRepository([]))).toThrow(
      /ANDROID/u,
    );
  });
});
