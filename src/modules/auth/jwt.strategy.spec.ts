import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';
import { JwtStrategy } from './jwt.strategy';

const payload: JwtPayload = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: UserRole.CLIENT,
};

function strategyFor(account: Record<string, unknown> | null): JwtStrategy {
  const usersRepository = {
    findActiveById: jest.fn().mockResolvedValue(account),
  } as unknown as UsersRepository;
  return new JwtStrategy(usersRepository);
}

describe('JwtStrategy', () => {
  it('returns the current persisted role for an active principal', async () => {
    const strategy = strategyFor({
      id: payload.sub,
      email: payload.email,
      role: UserRole.ADMIN,
      tenantId: 'topfitness',
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: payload.sub,
      email: payload.email,
      role: UserRole.ADMIN,
      tenantId: 'topfitness',
    });
  });

  it('keeps the account gym even when the installation declares a different default', async () => {
    const strategy = strategyFor({
      id: payload.sub,
      email: payload.email,
      role: UserRole.CLIENT,
      tenantId: 'gymsheet',
    });

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      tenantId: 'gymsheet',
    });
  });

  /**
   * Las cuentas creadas antes de existir el campo no tienen gimnasio guardado.
   * Sin este respaldo seguirían viendo la marca genérica en una instalación que
   * sí tiene marca propia, que es exactamente el fallo que se estaba corrigiendo.
   */
  it('falls back to the installation gym when the account has none', async () => {
    const strategy = strategyFor({
      id: payload.sub,
      email: payload.email,
      role: UserRole.CLIENT,
      tenantId: null,
    });

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      tenantId: env.DEFAULT_TENANT_ID ?? null,
    });
  });

  it('rejects a token when the user is missing or inactive', async () => {
    const strategy = strategyFor(null);

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
