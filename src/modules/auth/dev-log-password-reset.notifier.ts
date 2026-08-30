import { Injectable, Logger } from '@nestjs/common';
import { PasswordResetNotification, PasswordResetNotifier } from './password-reset-notifier';

/**
 * Development-only stand-in: prints the reset PIN to the server log instead
 * of emailing it, so the reset flow can be exercised locally without a real
 * email provider. Selected only when `PASSWORD_RESET_DEV_LOG_ENABLED` is
 * set, which `env.ts` refuses to accept when `NODE_ENV=production` — the
 * same pattern already used for `ACCESS_MOCK_ENABLED`. Never wire this
 * adapter in a real deployment: it puts a credential-equivalent secret in
 * plain-text logs.
 */
@Injectable()
export class DevLogPasswordResetNotifier implements PasswordResetNotifier {
  private readonly logger = new Logger(DevLogPasswordResetNotifier.name);

  async notify(notification: PasswordResetNotification): Promise<void> {
    this.logger.warn({
      event: 'auth.password_reset.dev_log_delivery',
      userId: notification.userId,
      resetPin: notification.pin,
      expiresAt: notification.expiresAt.toISOString(),
    });
  }
}
