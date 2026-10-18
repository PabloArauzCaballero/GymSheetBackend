import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize-typescript';
import { UsersRepository } from '../users/users.repository';
import { TenantsService } from '../tenants/tenants.service';
import { AuthService } from './auth.service';
import { RefreshTokenRepository } from './refresh-token.repository';

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
      .login({ email: registeredEmail, password: submittedPassword })
      .catch((error: unknown) => error);
    const unknownAccountError = await unknownAccountService
      .login({ email: unregisteredEmail, password: submittedPassword })
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
      service.login({ email: unregisteredEmail, password: submittedPassword }),
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
      .login({ email: registeredEmail, password: 'right-password' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toMatch(/suspendida/u);
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
    });
  });

  it('no expone nada más de la cuenta (ni el hash de la contraseña)', async () => {
    const service = createService({
      findActiveById: jest.fn().mockResolvedValue({ fullName: 'Registered User', passwordHash: STORED_HASH }),
    });
    expect(JSON.stringify(await service.me(principal))).not.toContain(STORED_HASH);
  });
});
