import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';

@Injectable()
export class MockNotificationAdapter implements NotificationDeliveryAdapter {
  async deliver(
    _request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryResult> {
    return {
      provider: 'MOCK',
      providerMessageId: randomUUID(),
      responseCode: 'MOCK_ACCEPTED',
    };
  }
}
