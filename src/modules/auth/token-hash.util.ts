import { createHmac, randomBytes, randomInt } from 'crypto';
import { env } from '../../config/env';

/** Raw token length in bytes before hex-encoding (64 hex characters). */
const RAW_TOKEN_BYTES = 32;

/** Digits in a password-reset PIN, matching the flow already built in `apps/web`. */
const PASSWORD_RESET_PIN_LENGTH = 6;
const PASSWORD_RESET_PIN_EXCLUSIVE_MAX = 10 ** PASSWORD_RESET_PIN_LENGTH;

export type TokenPurpose = 'refresh' | 'password-reset';

/**
 * Opaque bearer tokens (refresh, password-reset) are random values the
 * server never needs to decode, only to recognize on a later request. They
 * are stored as a keyed hash rather than the raw value — same principle as
 * password hashing — so a database read alone never yields something a
 * caller can present back to the API.
 *
 * `JWT_REFRESH_SECRET` doubles as the HMAC key: it already exists as a
 * provisioned, distinct-from-the-access-secret value (see `env.ts`), and an
 * HMAC pepper needs exactly that shape. `purpose` is mixed into the input so
 * a refresh token and a password-reset token can never be confused for one
 * another even if their random bytes happened to collide.
 */
export function issueOpaqueToken(purpose: TokenPurpose): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(RAW_TOKEN_BYTES).toString('hex');
  return { rawToken, tokenHash: hashOpaqueToken(purpose, rawToken) };
}

/** Derives the storable hash for a token a caller presented back. */
export function hashOpaqueToken(purpose: TokenPurpose, rawToken: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(`${purpose}:${rawToken}`).digest('hex');
}

/**
 * A password-reset PIN is short (6 digits) and user-typed, unlike the opaque
 * link-style tokens above: it trades the astronomical unguessability of 256
 * random bits for something a person can read off an email and type in a
 * phone keypad. That trade only stays safe because the PIN is single-use,
 * short-lived, and capped on wrong guesses — see `AuthService.confirmPasswordReset`.
 */
export function issuePasswordResetPin(): { rawPin: string; pinHash: string } {
  const rawPin = randomInt(0, PASSWORD_RESET_PIN_EXCLUSIVE_MAX)
    .toString()
    .padStart(PASSWORD_RESET_PIN_LENGTH, '0');
  return { rawPin, pinHash: hashOpaqueToken('password-reset', rawPin) };
}
