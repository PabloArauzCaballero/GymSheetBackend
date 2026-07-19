import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { env } from '../../../config/env';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';

@Injectable()
export class HttpGatewayNotificationAdapter implements NotificationDeliveryAdapter {
  async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryResult> {
    if (!env.NOTIFICATION_GATEWAY_URL || !env.NOTIFICATION_GATEWAY_SECRET) {
      throw new ServiceUnavailableException('Notification gateway is not configured.');
    }

    const timestamp = new Date().toISOString();
    const body = JSON.stringify({
      notificationId: request.notificationId,
      recipientUserId: request.recipientUserId,
      subject: request.subject,
      body: request.body,
      daysRemaining: request.daysRemaining,
    });
    const signature = createHmac('sha256', env.NOTIFICATION_GATEWAY_SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.NOTIFICATION_GATEWAY_TIMEOUT_MS,
    );

    try {
      const response = await fetch(env.NOTIFICATION_GATEWAY_URL, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-GymSheet-Timestamp': timestamp,
          'X-GymSheet-Signature': `sha256=${signature}`,
          'X-Idempotency-Key': request.idempotencyKey,
        },
        body,
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Notification gateway returned HTTP ${response.status}.`,
        );
      }
      return {
        provider: 'HTTP_GATEWAY',
        providerMessageId: response.headers.get('x-provider-message-id'),
        responseCode: String(response.status),
      };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Notification gateway request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
