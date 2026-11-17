import { SetMetadata } from '@nestjs/common';

export const REQUIRES_VERIFIED_EMAIL_KEY = 'requiresVerifiedEmail';

/**
 * Marks a route (or a whole controller) as social: only accounts that proved
 * their mailbox may use it. Enforced by the global `EmailVerificationGuard`.
 */
export const RequiresVerifiedEmail = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRES_VERIFIED_EMAIL_KEY, true);
