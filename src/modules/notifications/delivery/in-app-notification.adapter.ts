import { Injectable } from '@nestjs/common';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';

@Injectable()
export class InAppNotificationAdapter implements NotificationDeliveryAdapter {
  async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryResult> {
    return {
      provider: 'IN_APP',
      providerMessageId: request.notificationId,
      responseCode: 'STORED',
    };
  }
}
