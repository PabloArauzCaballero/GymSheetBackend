import { Injectable, Logger } from '@nestjs/common';
import { DeviceTokenRepository } from '../device-token.repository';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TIMEOUT_MS = 10_000;
const EXPO_PUSH_BATCH_SIZE = 100;

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushSendResult = {
  sent: number;
  deactivated: number;
};

/**
 * Empuja notificaciones reales vía la API de Expo, que a su vez las reenvía por FCM (Android) o
 * APNs (iOS) usando las credenciales que ya se subieron al proyecto de EAS. El backend nunca
 * habla directo con Firebase: solo conoce tokens `ExponentPushToken[...]`.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger('ExpoPushService');

  constructor(private readonly deviceTokens: DeviceTokenRepository) {}

  /**
   * Envío best-effort: nunca lanza. Una falla de push no debe tumbar la entrega in-app, que es
   * la fuente de verdad de la notificación (ver InAppNotificationAdapter).
   */
  async sendToUser(
    userId: string,
    notification: { title: string | null; body: string },
  ): Promise<ExpoPushSendResult> {
    const tokens = await this.deviceTokens.findActiveTokens(userId);
    if (tokens.length === 0) return { sent: 0, deactivated: 0 };

    let sent = 0;
    let deactivated = 0;

    for (let i = 0; i < tokens.length; i += EXPO_PUSH_BATCH_SIZE) {
      const batch = tokens.slice(i, i + EXPO_PUSH_BATCH_SIZE);
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
            batch.map((to) => ({
              to,
              title: notification.title ?? undefined,
              body: notification.body,
              sound: 'default',
              priority: 'high',
            })),
          ),
        });
        if (!response.ok) {
          this.logger.warn({
            event: 'push.batch_failed',
            status: response.status,
          });
          continue;
        }
        const payload = (await response.json()) as { data?: ExpoPushTicket[] };
        const tickets = payload.data ?? [];
        for (let j = 0; j < tickets.length; j += 1) {
          const ticket = tickets[j];
          const token = batch[j];
          if (ticket.status === 'ok') {
            sent += 1;
            continue;
          }
          this.logger.warn({
            event: 'push.ticket_error',
            message: ticket.message,
            errorCode: ticket.details?.error,
          });
          if (ticket.details?.error === 'DeviceNotRegistered') {
            await this.deviceTokens.deactivateByToken(token);
            deactivated += 1;
          }
        }
      } catch (error) {
        this.logger.warn({
          event: 'push.request_failed',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    return { sent, deactivated };
  }
}
