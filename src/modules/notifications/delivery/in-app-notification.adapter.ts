import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';
import { ExpoPushService } from './expo-push.service';

@Injectable()
export class InAppNotificationAdapter implements NotificationDeliveryAdapter {
  private readonly logger = new Logger('InAppNotificationAdapter');

  constructor(private readonly expoPush: ExpoPushService) {}

  async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryResult> {
    // El mensaje IN_APP ya quedó grabado en `messages` antes de llegar aquí (es la fuente de
    // verdad); esto solo agrega un empujón real al teléfono si el usuario tiene algún
    // dispositivo registrado. Nunca puede tumbar la entrega in-app: un fallo de push queda
    // solo en el log, no propaga.
    try {
      const result = await this.expoPush.sendToUser(request.recipientUserId, {
        title: request.subject,
        body: request.body,
      });
      if (result.sent > 0) {
        this.logger.log({
          event: 'push.delivered',
          notificationId: request.notificationId,
          devices: result.sent,
        });
      }
    } catch (error) {
      this.logger.warn({
        event: 'push.delivery_failed',
        notificationId: request.notificationId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      provider: 'IN_APP',
      providerMessageId: request.notificationId,
      responseCode: 'STORED',
    };
  }
}
