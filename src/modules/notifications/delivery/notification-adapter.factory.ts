import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { NotificationChannel } from '../../../common/enums/domain.enums';
import { env } from '../../../config/env';
import { HttpGatewayNotificationAdapter } from './http-gateway-notification.adapter';
import { EmailNotificationAdapter } from './email-notification.adapter';
import { InAppNotificationAdapter } from './in-app-notification.adapter';
import { MockNotificationAdapter } from './mock-notification.adapter';
import { NotificationDeliveryAdapter } from './notification-delivery.adapter';

@Injectable()
export class NotificationAdapterFactory {
  constructor(
    private readonly inApp: InAppNotificationAdapter,
    private readonly email: EmailNotificationAdapter,
    private readonly httpGateway: HttpGatewayNotificationAdapter,
    private readonly mock: MockNotificationAdapter,
  ) {}

  forChannel(channel: NotificationChannel): NotificationDeliveryAdapter {
    if (channel === NotificationChannel.IN_APP) return this.inApp;
    // El correo no depende de NOTIFICATION_DELIVERY_PROVIDER: ese ajuste elige
    // entre pasarela externa y simulacro para el canal HTTP, y el buzón se
    // configura por su cuenta con MAIL_TRANSPORT.
    if (channel === NotificationChannel.EMAIL) return this.email;
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
