import { createHmac, randomBytes } from 'crypto';
import { env } from '../../config/env';

/** Raw token length in bytes before hex-encoding (64 hex characters). */
const RAW_TOKEN_BYTES = 32;

/**
 * Only refresh tokens use this scheme today. El PIN de recuperación se guarda
 * con bcrypt en `PasswordResetService`, no aquí. El propósito sigue mezclándose
 * en el HMAC para que añadir un segundo tipo de token no pueda confundirse con
 * el primero.
 */
export type TokenPurpose = 'refresh';

/**
 * Opaque bearer tokens are random values the server never needs to decode,
 * only to recognize on a later request. They
 * are stored as a keyed hash rather than the raw value — same principle as
 * password hashing — so a database read alone never yields something a
 * caller can present back to the API.
 *
 * `JWT_REFRESH_SECRET` doubles as the HMAC key: it already exists as a
 * provisioned, distinct-from-the-access-secret value (see `env.ts`), and an
 * HMAC pepper needs exactly that shape. `purpose` is mixed into the input so
 * dos familias de token distintas nunca puedan confundirse entre sí aunque sus
 * bytes aleatorios coincidieran.
 */
export function issueOpaqueToken(purpose: TokenPurpose): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(RAW_TOKEN_BYTES).toString('hex');
  return { rawToken, tokenHash: hashOpaqueToken(purpose, rawToken) };
}

/** Derives the storable hash for a token a caller presented back. */
export function hashOpaqueToken(purpose: TokenPurpose, rawToken: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(`${purpose}:${rawToken}`).digest('hex');
}
