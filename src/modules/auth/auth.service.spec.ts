import { UnauthorizedException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { PENDING_REVIEW_SUSPENSION_UNTIL } from '../../common/moderation/account-suspension';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize-typescript';
import { UsersRepository } from '../users/users.repository';
import { TenantsService } from '../tenants/tenants.service';
import { LegalService } from '../legal/legal.service';
import { SignupProtectionService } from '../antibot/signup-protection.service';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { AuthSessionService } from './auth-session.service';
import { AuthService } from './auth.service';
import { ClientDeviceContext } from './client-device-context';
import { EmailVerificationService } from './email-verification.service';
import { UserDeviceService } from './user-device.service';
import { RefreshTokenRepository } from './refresh-token.repository';

const noDevice: ClientDeviceContext = {
  installationId: null,
  platform: 'UNKNOWN',
  appVersion: null,
  osVersion: null,
  deviceModel: null,
  userAgent: null,
  ipHmac: null,
};
const registeredEmail = 'registered@example.test';
const unregisteredEmail = 'unregistered@example.test';
const submittedPassword = 'wrong-password';
const DECOY_HASH = '$2a$12$decoyhashforunknownaccountsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const STORED_HASH = '$2a$12$storedhashforknownaccountsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// `jest.mock` is hoisted above the constants above, so the factory repeats the
// literals rather than referencing them.
jest.mock('bcryptjs', () => ({
  // The service hashes a placeholder at module load to build the decoy.
  hashSync: jest.fn(() => '$2a$12$decoyhashforunknownaccountsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
  hash: jest.fn(() =>
    Promise.resolve('$2a$12$storedhashforknownaccountsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
  ),
  compare: jest.fn(() => Promise.resolve(false)),
}));

function createService(usersRepositoryOverrides: Partial<UsersRepository>): AuthService {
  // Neither test below reaches refresh-token issuance: both `login` calls
  // throw UnauthorizedException before AuthService would touch these. They
  // only need to satisfy the constructor's shape.
  return new AuthService(
    usersRepositoryOverrides as UsersRepository,
    // El registro valida el gimnasio contra el catálogo; estas pruebas sólo
    // ejercitan `login`, que no lo consulta.
    { assertActiveTenant: jest.fn() } as unknown as TenantsService,
    {} as RefreshTokenRepository,
    {} as JwtService,
    {} as Sequelize,
    {} as LegalService,
    {} as AuthSessionService,
    {} as UserDeviceService,
    {} as EmailVerificationService,
    {} as SignupProtectionService,
    {} as ClosedAccountSanctionsService,
  );
}

describe('AuthService login account enumeration resistance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a wrong password and an unknown email with the same message', async () => {
    const knownAccountService = createService({
      findActiveByEmail: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        email: registeredEmail,
        passwordHash: STORED_HASH,
        fullName: 'Registered User',
        role: 'CLIENTE',
      }),
    });
    const unknownAccountService = createService({
      findActiveByEmail: jest.fn().mockResolvedValue(null),
    });

    const knownAccountError = await knownAccountService
      .login({ email: registeredEmail, password: submittedPassword }, noDevice)
      .catch((error: unknown) => error);
    const unknownAccountError = await unknownAccountService
      .login({ email: unregisteredEmail, password: submittedPassword }, noDevice)
      .catch((error: unknown) => error);

    expect(knownAccountError).toBeInstanceOf(UnauthorizedException);
    expect(unknownAccountError).toBeInstanceOf(UnauthorizedException);
    expect((unknownAccountError as UnauthorizedException).message).toBe(
      (knownAccountError as UnauthorizedException).message,
    );
  });

  it('still performs a password comparison when no account matches', async () => {
    // The timing signal this guards against comes from skipping bcrypt
    // entirely on the unknown-email path, so assert the comparison happens.
    // `bcryptjs` exports non-configurable properties, so the call is observed
    // through a module mock rather than jest.spyOn.
    const { compare } = jest.requireMock<typeof bcrypt>('bcryptjs');
    const service = createService({
      findActiveByEmail: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.login({ email: unregisteredEmail, password: submittedPassword }, noDevice),
    ).rejects.toThrow(UnauthorizedException);

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith(submittedPassword, DECOY_HASH);
  });
});

describe('AuthService login de una cuenta suspendida', () => {
  it('responde 403 con el motivo, no el 401 de credenciales inválidas', async () => {
    const { compare } = jest.requireMock<{ compare: jest.Mock }>('bcryptjs');
    compare.mockResolvedValueOnce(true);
    const service = createService({
      findActiveByEmail: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        email: registeredEmail,
        passwordHash: STORED_HASH,
        fullName: 'Registered User',
        role: 'CLIENTE',
        suspendedUntil: new Date(Date.now() + 86_400_000),
      }),
    });

    const error = await service
      .login({ email: registeredEmail, password: 'right-password' }, noDevice)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).getStatus()).toBe(403);
    expect((error as DomainException).code).toBe('ACCOUNT_SUSPENDED');
    expect((error as DomainException).message).toMatch(/suspendida/u);
  });

  it('una suspensión pendiente de revisión no anuncia el año 9999', async () => {
    const { compare } = jest.requireMock<{ compare: jest.Mock }>('bcryptjs');
    compare.mockResolvedValueOnce(true);
    const service = createService({
      findActiveByEmail: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        email: registeredEmail,
        passwordHash: STORED_HASH,
        role: 'CLIENTE',
        suspendedUntil: PENDING_REVIEW_SUSPENSION_UNTIL,
      }),
    });

    await expect(service.login({ email: registeredEmail, password: 'right-password' }, noDevice))
      .rejects.toThrow('Tu cuenta está suspendida mientras revisamos un reporte.');
  });
});

describe('AuthService me', () => {
  const principal = {
    id: '00000000-0000-4000-8000-000000000001',
    email: registeredEmail,
    role: 'CLIENTE',
    tenantId: 'gym',
    tenantScope: 'gym',
    impersonating: false,
  } as unknown as Parameters<AuthService['me']>[0];

  it('conserva el principal y añade nombreCompleto y rol como en el login', async () => {
    const service = createService({ findActiveById: jest.fn().mockResolvedValue({ fullName: 'Registered User' }) });
    await expect(service.me(principal)).resolves.toEqual({
      ...principal,
      rol: 'CLIENTE',
      nombreCompleto: 'Registered User',
      emailVerified: false,
      verified: false,
    });
  });

  it('expone si la persona pasó la verificación con selfie, leído de la cuenta', async () => {
    const service = createService({
      findActiveById: jest.fn().mockResolvedValue({ fullName: 'Registered User', verifiedAt: new Date() }),
    });
    await expect(service.me(principal)).resolves.toMatchObject({ verified: true });
  });

  it('expone si el correo está verificado, leído de la cuenta', async () => {
    const service = createService({
      findActiveById: jest.fn().mockResolvedValue({ fullName: 'Registered User', emailVerifiedAt: new Date() }),
    });
    await expect(service.me(principal)).resolves.toMatchObject({ emailVerified: true });
  });

  it('no expone nada más de la cuenta (ni el hash de la contraseña)', async () => {
    const service = createService({
      findActiveById: jest.fn().mockResolvedValue({ fullName: 'Registered User', passwordHash: STORED_HASH }),
    });
    expect(JSON.stringify(await service.me(principal))).not.toContain(STORED_HASH);
  });
});
