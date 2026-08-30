import { Injectable, Logger } from '@nestjs/common';
import { PasswordResetNotification, PasswordResetNotifier } from './password-reset-notifier';

/**
 * Default adapter while no real email provider is wired in: completes the
 * request (so the reset flow's no-enumeration contract holds) without
 * sending anything, and logs — without the token — that delivery did not
 * happen, so the gap is visible in the logs rather than silently swallowed.
 */
@Injectable()
export class NullPasswordResetNotifier implements PasswordResetNotifier {
  private readonly logger = new Logger(NullPasswordResetNotifier.name);

  async notify(notification: PasswordResetNotification): Promise<void> {
    this.logger.warn({
      event: 'auth.password_reset.no_delivery_configured',
      userId: notification.userId,
    });
  }
}
