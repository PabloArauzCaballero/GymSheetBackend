import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { env } from '../../config/env';
import { durationToMilliseconds } from './duration';
import { RefreshTokensRepository } from './refresh-tokens.repository';

const INVALID_SESSION_MESSAGE = 'La sesión ya no es válida. Inicie sesión de nuevo.';

/** Outcome of a rotation, decided inside the transaction and acted on after it commits. */
type RotationOutcome =
  | { kind: 'rotated'; userId: string; refreshToken: string }
  | { kind: 'rejected' };

/**
 * Rotating refresh tokens with reuse detection (SEC-02).
 *
 * - Each refresh consumes the presented token and issues a new one in the same
 *   family (session). The new one expires `JWT_REFRESH_EXPIRES_IN` after THIS
 *   use, so the session slides: it only ends after that long without use.
 * - Presenting a token that was already rotated or revoked means it leaked (or
 *   two clients share it): the whole family is revoked, legitimate holder
 *   included, so a stolen token stops working as soon as either side uses it.
 * - Only an HMAC of the token is stored.
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly repository: RefreshTokensRepository) {}

  /** Starts a new session family for a fresh login or registration. */
  async issueForNewSession(userId: string): Promise<string> {
    const refreshToken = generateRefreshToken();
    await this.repository.insert({
      id: randomUUID(),
      userId,
      familyId: randomUUID(),
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: nextExpiry(),
    });
    return refreshToken;
  }

  /**
   * Consumes [presentedToken] and returns the owner plus its successor.
   * [isUserActive] runs inside the same transaction: a blocked or deleted
   * account loses the session instead of being renewed.
   */
  async rotate(
    presentedToken: string,
    isUserActive: (userId: string) => Promise<boolean>,
  ): Promise<{ userId: string; refreshToken: string }> {
    const outcome = await this.repository.transaction<RotationOutcome>(async (transaction) => {
      const stored = await this.repository.findByHashForUpdate(
        hashRefreshToken(presentedToken),
        transaction,
      );
      if (!stored) return { kind: 'rejected' };

      // Reuse of a rotated/revoked token, an expired token or a deactivated
      // account: the session ends. Revoking is returned, not thrown, so the
      // revocation commits.
      if (
        stored.revokedAt !== null ||
        stored.expiresAt.getTime() <= Date.now() ||
        !(await isUserActive(stored.userId))
      ) {
        await this.repository.revokeFamily(stored.familyId, transaction);
        return { kind: 'rejected' };
      }

      const refreshToken = generateRefreshToken();
      const successorId = randomUUID();
      await this.repository.insert(
        {
          id: successorId,
          userId: stored.userId,
          familyId: stored.familyId,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: nextExpiry(),
        },
        transaction,
      );
      await this.repository.markRotated(stored.id, successorId, transaction);
      return { kind: 'rotated', userId: stored.userId, refreshToken };
    });

    if (outcome.kind === 'rejected') {
      throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
    }
    return { userId: outcome.userId, refreshToken: outcome.refreshToken };
  }

  /**
   * Ends the session [presentedToken] belongs to. Idempotent: an unknown or
   * already revoked token is not an error (logging out twice is still logged out).
   */
  async revokeSession(presentedToken: string): Promise<boolean> {
    return this.repository.transaction(async (transaction) => {
      const stored = await this.repository.findByHashForUpdate(
        hashRefreshToken(presentedToken),
        transaction,
      );
      if (!stored) return false;
      const wasLive = stored.revokedAt === null;
      await this.repository.revokeFamily(stored.familyId, transaction);
      return wasLive;
    });
  }
}

/** 256 random bits, URL-safe. Opaque on purpose: it carries no claims. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed hash, so a database dump alone cannot be turned back into working tokens. */
export function hashRefreshToken(refreshToken: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(refreshToken).digest('hex');
}

function nextExpiry(): Date {
  return new Date(Date.now() + durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN));
}
