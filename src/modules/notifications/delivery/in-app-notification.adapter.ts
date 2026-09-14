import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';
import { PushDispatcherService } from './push-dispatcher.service';

/** Dónde aterriza el usuario al pulsar el aviso; la resuelve el cliente. */
const NOTIFICATION_LANDING_PATH = '/notifications';

@Injectable()
export class InAppNotificationAdapter implements NotificationDeliveryAdapter {
  private readonly logger = new Logger('InAppNotificationAdapter');

  constructor(private readonly push: PushDispatcherService) {}

  async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryResult> {
    // El mensaje IN_APP ya quedó grabado en `messages` antes de llegar aquí (es la fuente de
    // verdad); esto solo agrega un empujón real al teléfono o al navegador si el usuario tiene
    // algún dispositivo registrado. Nunca puede tumbar la entrega in-app: un fallo de push queda
    // solo en el log, no propaga.
    try {
      const result = await this.push.sendToUser(request.recipientUserId, {
        title: request.subject,
        body: request.body,
        url: NOTIFICATION_LANDING_PATH,
      });
      if (result.delivered > 0) {
        this.logger.log({
          event: 'push.delivered',
          notificationId: request.notificationId,
          devices: result.delivered,
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
