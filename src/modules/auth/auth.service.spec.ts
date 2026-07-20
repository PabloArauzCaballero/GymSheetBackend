import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';

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
  return new AuthService(usersRepositoryOverrides as UsersRepository, {} as JwtService);
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
