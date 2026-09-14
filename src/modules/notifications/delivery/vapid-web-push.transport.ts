import { Injectable, Logger } from '@nestjs/common';
import { WebPushError, sendNotification } from 'web-push';
import { DevicePlatform } from '../device-token.model';
import {
  PushDeliveryOutcome,
  PushMessage,
  PushTarget,
  PushTransport,
} from './push.transport';
import { isAllowedWebPushEndpoint } from './web-push-endpoint';

/** Credenciales y límites del transporte; las resuelve el factory al arrancar. */
export interface VapidWebPushConfig {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs: number;
  readonly ttlSeconds: number;
}

/**
 * Entrega Web Push con VAPID (RFC 8291 para el cifrado del cuerpo, RFC 8292 para
 * la identificación del servidor). Ver ADR-0011.
 *
 * A diferencia de Expo no hay lote posible: cada cuerpo se cifra con las claves
 * de SU suscripción, así que es una petición HTTP por navegador. Se envían en
 * paralelo porque son independientes entre sí y el tiempo total de un usuario
 * con varios navegadores no debe ser la suma de todos.
 *
 * Best-effort como el resto del push: nunca lanza. La notificación in-app ya
 * está guardada antes de llegar aquí y es la fuente de verdad.
 */
@Injectable()
export class VapidWebPushTransport implements PushTransport {
  readonly name = 'WEB_PUSH';
  readonly platforms: readonly DevicePlatform[] = [DevicePlatform.WEB];

  private readonly logger = new Logger('VapidWebPushTransport');

  constructor(private readonly config: VapidWebPushConfig) {}

  async send(
    targets: readonly PushTarget[],
    message: PushMessage,
  ): Promise<readonly PushDeliveryOutcome[]> {
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
    });
    return Promise.all(targets.map((target) => this.sendOne(target, payload)));
  }

  private async sendOne(target: PushTarget, payload: string): Promise<PushDeliveryOutcome> {
    // Segunda comprobación de la allowlist, después de la del alta: una fila ya
    // guardada puede haber quedado fuera porque el despliegue redujo la lista, y
    // el sitio donde eso importa es justo antes de abrir la conexión.
    if (!isAllowedWebPushEndpoint(target.pushToken, this.config.allowedHosts)) {
      this.logger.warn({ event: 'push.web.endpoint_not_allowed', targetId: target.id });
      return { targetId: target.id, status: 'FAILED' };
    }
    if (!target.p256dh || !target.auth) {
      // El CHECK de la tabla lo impide; si llegase aquí, la fila está corrupta y
      // no hay forma de cifrar para ella.
      this.logger.warn({ event: 'push.web.missing_keys', targetId: target.id });
      return { targetId: target.id, status: 'GONE' };
    }
    try {
      await sendNotification(
        {
          endpoint: target.pushToken,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        {
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
          TTL: this.config.ttlSeconds,
          timeout: this.config.timeoutMs,
          contentEncoding: 'aes128gcm',
        },
      );
      return { targetId: target.id, status: 'DELIVERED' };
    } catch (error) {
      return { targetId: target.id, status: this.classify(error, target.id) };
    }
  }

  /**
   * 404 y 410 son la forma que tiene el servicio de push de decir «esta
   * suscripción ya no existe»: el usuario revocó el permiso, borró los datos del
   * sitio o cambió de navegador. Esa fila se da de baja. Cualquier otro estado
   * —429 por cuota, 5xx del servicio, un fallo de red— es transitorio y se
   * queda en el registro.
   */
  private classify(error: unknown, targetId: string): PushDeliveryOutcome['status'] {
    if (error instanceof WebPushError) {
      const gone = error.statusCode === 404 || error.statusCode === 410;
      this.logger.warn({
        event: gone ? 'push.web.subscription_gone' : 'push.web.rejected',
        targetId,
        status: error.statusCode,
      });
      return gone ? 'GONE' : 'FAILED';
    }
    this.logger.warn({
      event: 'push.web.request_failed',
      targetId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return 'FAILED';
  }
}
