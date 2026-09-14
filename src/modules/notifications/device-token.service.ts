import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../config/env';
import { PushDispatcherService } from './delivery/push-dispatcher.service';
import { DevicePlatform } from './device-token.model';
import { DeviceTokenRepository, DeviceTokenUpsert } from './device-token.repository';
import { RegisterDeviceTokenInput, UnregisterDeviceTokenInput } from './device-token.schemas';

/**
 * Traduce el cuerpo que manda cada cliente a la forma con la que se persiste un
 * destino. Los dos cuerpos no se parecen —el móvil manda una cadena de Expo, el
 * navegador manda una URL más dos claves— y esta es la única función que conoce
 * esa diferencia: de aquí hacia dentro sólo hay `pushToken` y, si toca, claves.
 */
function toUpsert(input: RegisterDeviceTokenInput): DeviceTokenUpsert {
  if (input.platform === DevicePlatform.WEB) {
    return {
      platform: DevicePlatform.WEB,
      pushToken: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    };
  }
  return {
    platform: input.platform,
    pushToken: input.expoPushToken,
    p256dh: null,
    auth: null,
  };
}

function toPushToken(input: UnregisterDeviceTokenInput): string {
  return 'expoPushToken' in input ? input.expoPushToken : input.endpoint;
}

@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly repository: DeviceTokenRepository,
    private readonly push: PushDispatcherService,
  ) {}

  async register(userId: string, input: RegisterDeviceTokenInput): Promise<void> {
    // Guardar una suscripción para una plataforma sin transporte sería prometer
    // un aviso que nadie va a entregar. Mejor decirlo: el cliente enseña que el
    // push web no está configurado en vez de mostrar «suscrito» y no sonar nunca.
    if (!this.push.supports(input.platform)) {
      throw new ServiceUnavailableException(
        `Este despliegue no entrega notificaciones push a la plataforma ${input.platform}.`,
      );
    }
    await this.repository.upsert(userId, toUpsert(input));
  }

  unregister(userId: string, input: UnregisterDeviceTokenInput): Promise<void> {
    return this.repository.deactivate(userId, toPushToken(input));
  }

  /**
   * Lo que el navegador necesita ANTES de poder suscribirse: si este despliegue
   * hace push web, y con qué clave pública (`applicationServerKey`).
   *
   * Se sirve desde el backend en vez de duplicarla en una variable del front
   * porque es la mitad pública de un par que vive aquí: dos copias acaban
   * divergiendo, y una clave pública que no corresponde a la privada produce
   * suscripciones que el servicio de push rechaza sin explicar por qué.
   */
  webPushConfig(): { enabled: boolean; publicKey: string | null } {
    const enabled = this.push.supports(DevicePlatform.WEB);
    return { enabled, publicKey: enabled ? (env.VAPID_PUBLIC_KEY ?? null) : null };
  }
}
