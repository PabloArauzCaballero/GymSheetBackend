import { BusinessDateService } from '../../common/time/business-date.service';
import { DevicePlatform } from '../../common/enums/domain.enums';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { DeviceTokenRepository } from './device-token.repository';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
} from './notifications.schemas';

const userId = '00000000-0000-4000-8000-0000000000aa';
const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

function createService(overrides: Partial<DeviceTokenRepository> = {}) {
  const deviceTokens = {
    register: jest.fn().mockResolvedValue({ id: 'row-1' }),
    revoke: jest.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as DeviceTokenRepository;
  const service = new NotificationService(
    {} as unknown as NotificationRepository,
    deviceTokens,
    {} as unknown as BusinessDateService,
    {} as unknown as DomainEventPublisher,
    {} as unknown as never,
  );
  return { service, deviceTokens };
}

describe('registerDeviceTokenSchema', () => {
  it('accepts the two token shapes Expo emits', () => {
    for (const candidate of [token, 'ExpoPushToken[abc-123_XYZ]']) {
      expect(
        registerDeviceTokenSchema.safeParse({
          expoPushToken: candidate,
          platform: DevicePlatform.ANDROID,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects anything that is not an Expo token', () => {
    for (const candidate of ['', 'fcm-raw-token', 'ExponentPushToken[]', `${token} `.repeat(20)]) {
      expect(
        registerDeviceTokenSchema.safeParse({
          expoPushToken: candidate,
          platform: DevicePlatform.ANDROID,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects an unknown platform and any extra field', () => {
    expect(
      registerDeviceTokenSchema.safeParse({ expoPushToken: token, platform: 'WEB' }).success,
    ).toBe(false);
    expect(
      registerDeviceTokenSchema.safeParse({
        expoPushToken: token,
        platform: DevicePlatform.IOS,
        userId: 'someone-else',
      }).success,
    ).toBe(false);
  });

  it('takes only the token to unregister', () => {
    expect(unregisterDeviceTokenSchema.safeParse({ expoPushToken: token }).success).toBe(true);
    expect(
      unregisterDeviceTokenSchema.safeParse({ expoPushToken: token, userId }).success,
    ).toBe(false);
  });
});

describe('NotificationService device tokens', () => {
  it('registers the device against the session, never a body-supplied user', async () => {
    const { service, deviceTokens } = createService();

    await expect(
      service.registerDeviceToken(userId, {
        expoPushToken: token,
        platform: DevicePlatform.IOS,
      }),
    ).resolves.toEqual({ registered: true });
    expect(deviceTokens.register).toHaveBeenCalledWith({
      userId,
      expoPushToken: token,
      platform: DevicePlatform.IOS,
    });
  });

  it('answers the same whether or not there was a token to revoke', async () => {
    const { service, deviceTokens } = createService({
      revoke: jest.fn().mockResolvedValue(0),
    });

    await expect(
      service.unregisterDeviceToken(userId, { expoPushToken: token }),
    ).resolves.toEqual({ registered: false });
    // La baja va acotada al dueño: un token ajeno no se toca.
    expect(deviceTokens.revoke).toHaveBeenCalledWith(userId, token);
  });
});
