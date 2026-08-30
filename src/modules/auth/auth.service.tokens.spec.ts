import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import { RefreshTokenRevokedReason } from '../../common/enums/domain.enums';
import { UsersRepository } from '../users/users.repository';
import { TenantsService } from '../tenants/tenants.service';
import { AuthService } from './auth.service';
import { PasswordResetNotifier } from './password-reset-notifier';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { RefreshTokenRepository } from './refresh-token.repository';

jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '$2a$12$decoyhashforunknownaccountsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
  hash: jest.fn(() => Promise.resolve('$2a$12$newlyhashedpasswordxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')),
  compare: jest.fn(() => Promise.resolve(true)),
}));

const ACTIVE_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'athlete@example.test',
  passwordHash: 'irrelevant-for-these-tests',
  fullName: 'Athlete',
  role: 'CLIENTE',
  tenantId: null,
};

function buildService(overrides: {
  usersRepository?: Partial<UsersRepository>;
  refreshTokenRepository?: Partial<RefreshTokenRepository>;
  passwordResetTokenRepository?: Partial<PasswordResetTokenRepository>;
  passwordResetNotifier?: Partial<PasswordResetNotifier>;
  jwtService?: Partial<JwtService>;
}) {
  const sequelize = {
    // Runs the work eagerly against a stub transaction — good enough for a
    // unit test that only cares which repository calls happen and in what
    // order, not real atomicity (that belongs to an e2e test against Postgres).
    transaction: jest.fn((callback: (transaction: unknown) => unknown) => callback({})),
  } as unknown as Sequelize;

  return new AuthService(
    (overrides.usersRepository ?? {}) as UsersRepository,
    { assertActiveTenant: jest.fn() } as unknown as TenantsService,
    (overrides.refreshTokenRepository ?? {}) as RefreshTokenRepository,
    (overrides.passwordResetTokenRepository ?? {}) as PasswordResetTokenRepository,
    (overrides.jwtService ?? {}) as JwtService,
    sequelize,
    (overrides.passwordResetNotifier ?? { notify: jest.fn() }) as PasswordResetNotifier,
  );
}

describe('AuthService.refresh', () => {
  it('rejects an unrecognized token', async () => {
    const service = buildService({
      refreshTokenRepository: { findByHash: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.refresh('a'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the whole rotation family when a revoked token is presented again', async () => {
    const revokeFamily = jest.fn().mockResolvedValue([1]);
    const service = buildService({
      refreshTokenRepository: {
        findByHash: jest.fn().mockResolvedValue({
          id: 'token-1',
          familyId: 'family-1',
          userId: ACTIVE_USER.id,
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
        revokeFamily,
      },
    });

    await expect(service.refresh('a'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(revokeFamily).toHaveBeenCalledWith('family-1', RefreshTokenRevokedReason.REUSE_DETECTED);
  });

  it('rejects an expired token without touching it', async () => {
    const revoke = jest.fn();
    const service = buildService({
      refreshTokenRepository: {
        findByHash: jest.fn().mockResolvedValue({
          id: 'token-1',
          familyId: 'family-1',
          userId: ACTIVE_USER.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() - 1_000),
        }),
        revoke,
      },
    });

    await expect(service.refresh('a'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('rotates a valid token: the old one is revoked and a new one is issued in the same family', async () => {
    const revoke = jest.fn().mockResolvedValue([1]);
    const create = jest.fn().mockResolvedValue(undefined);
    const service = buildService({
      usersRepository: { findActiveById: jest.fn().mockResolvedValue(ACTIVE_USER) },
      refreshTokenRepository: {
        findByHash: jest.fn().mockResolvedValue({
          id: 'token-1',
          familyId: 'family-1',
          userId: ACTIVE_USER.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        revoke,
        create,
      },
      jwtService: { sign: jest.fn(() => 'signed-jwt') },
    });

    const result = await service.refresh('a'.repeat(64));

    expect(revoke).toHaveBeenCalledWith('token-1', RefreshTokenRevokedReason.ROTATED, expect.anything());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTIVE_USER.id, familyId: 'family-1' }),
      expect.anything(),
    );
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthService.logout', () => {
  it('is a silent no-op for an unknown token', async () => {
    const revoke = jest.fn();
    const service = buildService({
      refreshTokenRepository: { findByHash: jest.fn().mockResolvedValue(null), revoke },
    });

    await expect(service.logout('a'.repeat(64))).resolves.toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a live token', async () => {
    const revoke = jest.fn().mockResolvedValue([1]);
    const service = buildService({
      refreshTokenRepository: {
        findByHash: jest.fn().mockResolvedValue({ id: 'token-1', revokedAt: null }),
        revoke,
      },
    });

    await service.logout('a'.repeat(64));

    expect(revoke).toHaveBeenCalledWith('token-1', RefreshTokenRevokedReason.LOGOUT);
  });
});

describe('AuthService.requestPasswordReset', () => {
  it('does nothing observable for an unknown email, but returns the same generic message', async () => {
    const notify = jest.fn();
    const create = jest.fn();
    const service = buildService({
      usersRepository: { findActiveByEmail: jest.fn().mockResolvedValue(null) },
      passwordResetTokenRepository: { create },
      passwordResetNotifier: { notify },
    });

    const result = await service.requestPasswordReset({ email: 'unknown@example.test' });

    expect(create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(result.message).toMatch(/Si existe una cuenta/);
  });

  it('invalidates any previous code, issues a fresh 6-digit PIN, and notifies', async () => {
    const invalidateActiveForUser = jest.fn().mockResolvedValue([0]);
    const create = jest.fn().mockResolvedValue(undefined);
    const notify = jest.fn();
    const service = buildService({
      usersRepository: { findActiveByEmail: jest.fn().mockResolvedValue(ACTIVE_USER) },
      passwordResetTokenRepository: { invalidateActiveForUser, create },
      passwordResetNotifier: { notify },
    });

    const result = await service.requestPasswordReset({ email: ACTIVE_USER.email });

    expect(invalidateActiveForUser).toHaveBeenCalledWith(ACTIVE_USER.id, expect.anything());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTIVE_USER.id }),
      expect.anything(),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTIVE_USER.id, pin: expect.stringMatching(/^\d{6}$/) }),
    );
    expect(result.message).toMatch(/Si existe una cuenta/);
  });
});

describe('AuthService.confirmPasswordReset', () => {
  const baseInput = { email: ACTIVE_USER.email, pin: '123456', password: 'a-new-password' };

  it('rejects an unknown email with the generic message', async () => {
    const service = buildService({
      usersRepository: { findActiveByEmail: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.confirmPasswordReset(baseInput)).rejects.toThrow(
      'El código no es válido o ha caducado.',
    );
  });

  it('rejects when there is no active PIN for the user', async () => {
    const service = buildService({
      usersRepository: { findActiveByEmail: jest.fn().mockResolvedValue(ACTIVE_USER) },
      passwordResetTokenRepository: { findActiveForUser: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.confirmPasswordReset(baseInput)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('increments attempts on a wrong PIN and burns the code once attempts are exhausted', async () => {
    const incrementAttempts = jest.fn().mockResolvedValue([1]);
    const invalidateActiveForUser = jest.fn().mockResolvedValue([1]);
    const service = buildService({
      usersRepository: { findActiveByEmail: jest.fn().mockResolvedValue(ACTIVE_USER) },
      passwordResetTokenRepository: {
        findActiveForUser: jest.fn().mockResolvedValue({
          id: 'reset-1',
          userId: ACTIVE_USER.id,
          tokenHash: 'does-not-match-anything',
          attempts: 4, // one below the default max of 5
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        }),
        incrementAttempts,
        invalidateActiveForUser,
      },
    });

    await expect(service.confirmPasswordReset(baseInput)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(incrementAttempts).toHaveBeenCalledWith('reset-1');
    // 5th wrong guess (attempts was already 4): the code is burned right away.
    expect(invalidateActiveForUser).toHaveBeenCalledWith(ACTIVE_USER.id);
  });

  it('rejects an expired PIN even with the correct digits', async () => {
    const service = buildService({
      usersRepository: { findActiveByEmail: jest.fn().mockResolvedValue(ACTIVE_USER) },
      passwordResetTokenRepository: {
        findActiveForUser: jest.fn().mockResolvedValue({
          id: 'reset-1',
          userId: ACTIVE_USER.id,
          tokenHash: 'irrelevant',
          attempts: 0,
          expiresAt: new Date(Date.now() - 1_000),
          usedAt: null,
        }),
      },
    });

    await expect(service.confirmPasswordReset(baseInput)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('on a correct PIN: updates the password, burns the code, and signs the user out everywhere', async () => {
    const { hashOpaqueToken } = jest.requireActual<typeof import('./token-hash.util')>('./token-hash.util');
    const updatePasswordHash = jest.fn().mockResolvedValue([1]);
    const invalidateActiveForUser = jest.fn().mockResolvedValue([1]);
    const revokeAllForUser = jest.fn().mockResolvedValue([2]);
    const service = buildService({
      usersRepository: {
        findActiveByEmail: jest.fn().mockResolvedValue(ACTIVE_USER),
        updatePasswordHash,
      },
      passwordResetTokenRepository: {
        findActiveForUser: jest.fn().mockResolvedValue({
          id: 'reset-1',
          userId: ACTIVE_USER.id,
          tokenHash: hashOpaqueToken('password-reset', baseInput.pin),
          attempts: 1,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        }),
        invalidateActiveForUser,
      },
      refreshTokenRepository: { revokeAllForUser },
    });

    const result = await service.confirmPasswordReset(baseInput);

    expect(updatePasswordHash).toHaveBeenCalledWith(ACTIVE_USER.id, expect.any(String), expect.anything());
    expect(invalidateActiveForUser).toHaveBeenCalledWith(ACTIVE_USER.id, expect.anything());
    expect(revokeAllForUser).toHaveBeenCalledWith(
      ACTIVE_USER.id,
      RefreshTokenRevokedReason.PASSWORD_RESET,
      expect.anything(),
    );
    expect(result.message).toMatch(/actualizada/);
  });
});
