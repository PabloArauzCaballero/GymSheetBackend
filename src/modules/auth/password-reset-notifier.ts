export type PasswordResetNotification = {
  userId: string;
  email: string;
  pin: string;
  expiresAt: Date;
};

export const PASSWORD_RESET_NOTIFIER = Symbol('PASSWORD_RESET_NOTIFIER');

/**
 * Delivers a password-reset token to its owner.
 *
 * No production-ready adapter ships with this backend: sending an email
 * requires an external provider (SMTP, SendGrid, SES, ...), which needs
 * credentials this project does not have and a dependency choice that needs
 * an ADR per `.claude/rules/70-library-selection.md`. Wire a real adapter
 * here — and provide it in `auth.module.ts` — before enabling this flow in
 * production; until then `NullPasswordResetNotifier` is used, and env.ts
 * refuses to boot with `PASSWORD_RESET_DEV_LOG_ENABLED=true` in production.
 */
export interface PasswordResetNotifier {
  notify(notification: PasswordResetNotification): Promise<void>;
}
