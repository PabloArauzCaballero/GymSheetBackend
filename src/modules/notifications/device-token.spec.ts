import { DeviceTokenRepository } from './device-token.repository';
import { DeviceTokenService } from './device-token.service';
import { DevicePlatform } from './device-token.model';
import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
} from './device-token.schemas';

const userId = '00000000-0000-4000-8000-0000000000aa';
const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

describe('registerDeviceTokenSchema', () => {
  it('acepta las dos formas de token que emite Expo', () => {
    for (const candidate of [token, 'ExpoPushToken[abc-123_XYZ]']) {
      expect(
        registerDeviceTokenSchema.safeParse({
          expoPushToken: candidate,
          platform: DevicePlatform.ANDROID,
        }).success,
      ).toBe(true);
    }
  });

  it('rechaza lo que no es un token de Expo', () => {
    for (const candidate of ['', 'fcm-crudo', 'ExponentPushToken[]']) {
      expect(
        registerDeviceTokenSchema.safeParse({
          expoPushToken: candidate,
          platform: DevicePlatform.ANDROID,
        }).success,
      ).toBe(false);
    }
  });

  it('rechaza una plataforma desconocida', () => {
    expect(
      registerDeviceTokenSchema.safeParse({ expoPushToken: token, platform: 'WEB' }).success,
    ).toBe(false);
  });

  it('para la baja solo hace falta el token', () => {
    expect(unregisterDeviceTokenSchema.safeParse({ expoPushToken: token }).success).toBe(true);
    expect(unregisterDeviceTokenSchema.safeParse({ expoPushToken: '' }).success).toBe(false);
  });
});

describe('DeviceTokenService', () => {
  it('registra el dispositivo a nombre de la sesión', async () => {
    const repository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
    } as unknown as DeviceTokenRepository;
    const service = new DeviceTokenService(repository);

    await service.register(userId, { expoPushToken: token, platform: DevicePlatform.IOS });

    expect(repository.upsert).toHaveBeenCalledWith(userId, DevicePlatform.IOS, token);
  });

  it('la baja va acotada al dueño del token', async () => {
    const repository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
    } as unknown as DeviceTokenRepository;
    const service = new DeviceTokenService(repository);

    await service.unregister(userId, { expoPushToken: token });

    // Sin el userId en el WHERE, cualquiera con sesión podría silenciar un
    // teléfono ajeno mandando un token que no es suyo.
    expect(repository.deactivate).toHaveBeenCalledWith(userId, token);
  });
});
