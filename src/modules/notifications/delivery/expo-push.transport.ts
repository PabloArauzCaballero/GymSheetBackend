import { Injectable, Logger } from '@nestjs/common';
import { DevicePlatform, EXPO_PLATFORMS } from '../device-token.model';
import {
  PushDeliveryOutcome,
  PushMessage,
  PushTarget,
  PushTransport,
} from './push.transport';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TIMEOUT_MS = 10_000;
const EXPO_PUSH_BATCH_SIZE = 100;

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Empuja notificaciones reales vía la API de Expo, que a su vez las reenvía por
 * FCM (Android) o APNs (iOS) usando las credenciales que ya se subieron al
 * proyecto de EAS. El backend nunca habla directo con Firebase: sólo conoce
 * tokens `ExponentPushToken[...]`.
 *
 * Envío best-effort: nunca lanza. Un fallo de push no debe tumbar la entrega
 * in-app, que es la fuente de verdad de la notificación (ver
 * `InAppNotificationAdapter`). Lo que no se pudo entregar vuelve como `FAILED`,
 * y lo que ya no existe como `GONE`.
 */
@Injectable()
export class ExpoPushTransport implements PushTransport {
  readonly name = 'EXPO';
  readonly platforms: readonly DevicePlatform[] = EXPO_PLATFORMS;

  private readonly logger = new Logger('ExpoPushTransport');

  async send(
    targets: readonly PushTarget[],
    message: PushMessage,
  ): Promise<readonly PushDeliveryOutcome[]> {
    const outcomes: PushDeliveryOutcome[] = [];
    for (let index = 0; index < targets.length; index += EXPO_PUSH_BATCH_SIZE) {
      const batch = targets.slice(index, index + EXPO_PUSH_BATCH_SIZE);
      outcomes.push(...(await this.sendBatch(batch, message)));
    }
    return outcomes;
  }

  private async sendBatch(
    batch: readonly PushTarget[],
    message: PushMessage,
  ): Promise<PushDeliveryOutcome[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPO_PUSH_TIMEOUT_MS);
    try {
      const response = await fetch(EXPO_PUSH_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(
          batch.map((target) => ({
            to: target.pushToken,
            title: message.title ?? undefined,
            body: message.body,
            sound: 'default',
            priority: 'high',
          })),
        ),
      });
      if (!response.ok) {
        this.logger.warn({ event: 'push.batch_failed', status: response.status });
        return batch.map((target) => ({ targetId: target.id, status: 'FAILED' as const }));
      }
      const payload = (await response.json()) as { data?: ExpoPushTicket[] };
      const tickets = payload.data ?? [];
      return batch.map((target, position) => ({
        targetId: target.id,
        status: this.classify(tickets[position]),
      }));
    } catch (error) {
      this.logger.warn({
        event: 'push.request_failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return batch.map((target) => ({ targetId: target.id, status: 'FAILED' as const }));
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Expo devuelve `DeviceNotRegistered` por token cuando la app se desinstaló o
   * el token caducó: ese destino ya no existe y hay que darlo de baja. Un ticket
   * ausente (la respuesta trajo menos de los que se pidieron) se trata como
   * fallo transitorio, no como baja: dar de baja por una respuesta incompleta
   * apagaría el push de un dispositivo sano.
   */
  private classify(ticket: ExpoPushTicket | undefined): PushDeliveryOutcome['status'] {
    if (!ticket) return 'FAILED';
    if (ticket.status === 'ok') return 'DELIVERED';
    this.logger.warn({
      event: 'push.ticket_error',
      message: ticket.message,
      errorCode: ticket.details?.error,
    });
    return ticket.details?.error === 'DeviceNotRegistered' ? 'GONE' : 'FAILED';
  }
}
