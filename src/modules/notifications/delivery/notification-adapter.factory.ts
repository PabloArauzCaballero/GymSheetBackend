import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { NotificationChannel } from '../../../common/enums/domain.enums';
import { env } from '../../../config/env';
import { HttpGatewayNotificationAdapter } from './http-gateway-notification.adapter';
import { InAppNotificationAdapter } from './in-app-notification.adapter';
import { MockNotificationAdapter } from './mock-notification.adapter';
import { NotificationDeliveryAdapter } from './notification-delivery.adapter';

@Injectable()
export class NotificationAdapterFactory {
  constructor(
    private readonly inApp: InAppNotificationAdapter,
    private readonly httpGateway: HttpGatewayNotificationAdapter,
    private readonly mock: MockNotificationAdapter,
  ) {}

  forChannel(channel: NotificationChannel): NotificationDeliveryAdapter {
    if (channel === NotificationChannel.IN_APP) return this.inApp;
    if (channel !== NotificationChannel.HTTP_GATEWAY) {
      throw new ServiceUnavailableException('Unsupported notification channel.');
    }
    if (env.NOTIFICATION_DELIVERY_PROVIDER === 'HTTP_GATEWAY') return this.httpGateway;
    if (env.NOTIFICATION_DELIVERY_PROVIDER === 'MOCK') return this.mock;
    throw new ServiceUnavailableException(
      'External delivery was requested but no external provider is configured.',
    );
  }
}
