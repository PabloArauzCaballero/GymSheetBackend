import { PushDispatcherService } from './delivery/push-dispatcher.service';
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

/** Despachador que sí sabe entregar a cualquier plataforma. */
function createPush(): PushDispatcherService {
  return {
    supports: jest.fn().mockReturnValue(true),
  } as unknown as PushDispatcherService;
}

describe('DeviceTokenService', () => {
  it('registra el dispositivo a nombre de la sesión', async () => {
    const repository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
    } as unknown as DeviceTokenRepository;
    const service = new DeviceTokenService(repository, createPush());

    await service.register(userId, { expoPushToken: token, platform: DevicePlatform.IOS });

    // Desde ADR-0011 el repositorio recibe el destino ya traducido: el token de
    // Expo va en `pushToken`, y las claves de cifrado quedan nulas porque un
    // destino móvil no las tiene.
    expect(repository.upsert).toHaveBeenCalledWith(userId, {
      platform: DevicePlatform.IOS,
      pushToken: token,
      p256dh: null,
      auth: null,
    });
  });

  it('la baja va acotada al dueño del token', async () => {
    const repository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
    } as unknown as DeviceTokenRepository;
    const service = new DeviceTokenService(repository, createPush());

    await service.unregister(userId, { expoPushToken: token });

    // Sin el userId en el WHERE, cualquiera con sesión podría silenciar un
    // teléfono ajeno mandando un token que no es suyo.
    expect(repository.deactivate).toHaveBeenCalledWith(userId, token);
  });
});
