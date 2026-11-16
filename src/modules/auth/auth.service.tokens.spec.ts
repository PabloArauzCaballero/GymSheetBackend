import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import { RefreshTokenRevokedReason } from '../../common/enums/domain.enums';
import { UsersRepository } from '../users/users.repository';
import { TenantsService } from '../tenants/tenants.service';
import { LegalService } from '../legal/legal.service';
import { SignupProtectionService } from '../antibot/signup-protection.service';
import { AuthSessionService } from './auth-session.service';
import { AuthService } from './auth.service';
import { ClientDeviceContext } from './client-device-context';
import { EmailVerificationService } from './email-verification.service';
import { UserDeviceService } from './user-device.service';
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

const noDevice: ClientDeviceContext = {
  installationId: null,
  platform: 'UNKNOWN',
  appVersion: null,
  osVersion: null,
  deviceModel: null,
  userAgent: null,
  ipHmac: null,
};

function buildService(overrides: {
  usersRepository?: Partial<UsersRepository>;
  refreshTokenRepository?: Partial<RefreshTokenRepository>;
  jwtService?: Partial<JwtService>;
  devices?: Partial<UserDeviceService>;
}) {
  const sequelize = {
    // Runs the work eagerly against a stub transaction — good enough for a
    // unit test that only cares which repository calls happen and in what
    // order, not real atomicity (that belongs to an e2e test against Postgres).
    transaction: jest.fn((callback: (transaction: unknown) => unknown) => callback({})),
  } as unknown as Sequelize;

  const refreshTokenRepository = (overrides.refreshTokenRepository ?? {}) as RefreshTokenRepository;
  const jwtService = (overrides.jwtService ?? {}) as JwtService;
  const devices = {
    resolveForRefresh: jest.fn().mockResolvedValue(null),
    ...overrides.devices,
  } as unknown as UserDeviceService;
  return new AuthService(
    (overrides.usersRepository ?? {}) as UsersRepository,
    { assertActiveTenant: jest.fn() } as unknown as TenantsService,
    refreshTokenRepository,
    jwtService,
    sequelize,
    {} as LegalService,
    new AuthSessionService(jwtService, refreshTokenRepository),
    devices,
    {} as EmailVerificationService,
    {} as SignupProtectionService,
  );
}

describe('AuthService.refresh', () => {
  it('rejects an unrecognized token', async () => {
    const service = buildService({
      refreshTokenRepository: { findByHash: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.refresh('a'.repeat(64), noDevice)).rejects.toBeInstanceOf(UnauthorizedException);
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

    await expect(service.refresh('a'.repeat(64), noDevice)).rejects.toBeInstanceOf(UnauthorizedException);
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

    await expect(service.refresh('a'.repeat(64), noDevice)).rejects.toBeInstanceOf(UnauthorizedException);
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

    const result = await service.refresh('a'.repeat(64), noDevice);

    expect(revoke).toHaveBeenCalledWith('token-1', RefreshTokenRevokedReason.ROTATED, expect.anything());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTIVE_USER.id, familyId: 'family-1' }),
      expect.anything(),
    );
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthService.refresh device binding', () => {
  const liveToken = {
    id: 'token-1',
    familyId: 'family-1',
    userId: ACTIVE_USER.id,
    deviceId: 'device-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };

  it('fails without rotating when the bound device was revoked', async () => {
    const revoke = jest.fn();
    const create = jest.fn();
    const service = buildService({
      usersRepository: { findActiveById: jest.fn().mockResolvedValue(ACTIVE_USER) },
      refreshTokenRepository: { findByHash: jest.fn().mockResolvedValue(liveToken), revoke, create },
      devices: { resolveForRefresh: jest.fn().mockRejectedValue(new UnauthorizedException('Sesión inválida.')) },
    });

    await expect(service.refresh('a'.repeat(64), noDevice)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(revoke).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the new token bound to the same device', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const resolveForRefresh = jest.fn().mockResolvedValue('device-1');
    const service = buildService({
      usersRepository: { findActiveById: jest.fn().mockResolvedValue(ACTIVE_USER) },
      refreshTokenRepository: {
        findByHash: jest.fn().mockResolvedValue(liveToken),
        revoke: jest.fn().mockResolvedValue([1]),
        create,
      },
      jwtService: { sign: jest.fn(() => 'signed-jwt') },
      devices: { resolveForRefresh },
    });

    await service.refresh('a'.repeat(64), noDevice);

    expect(resolveForRefresh).toHaveBeenCalledWith(ACTIVE_USER.id, 'device-1', noDevice, expect.anything());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: 'family-1', deviceId: 'device-1' }),
      expect.anything(),
    );
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
