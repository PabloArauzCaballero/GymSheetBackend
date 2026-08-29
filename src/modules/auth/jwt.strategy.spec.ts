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
      // Un ADMIN queda atado a su propio gimnasio: su alcance administrativo
      // es exactamente ese, nunca «todos».
      tenantScope: 'topfitness',
      impersonating: false,
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
   * Sin este respaldo seguirían sin filtro de tenant (visibles a cualquier
   * gimnasio), que es exactamente el hueco de aislamiento que se corrigió.
   */
  it('falls back to the default tenant when the account has none', async () => {
    const strategy = strategyFor({
      id: payload.sub,
      email: payload.email,
      role: UserRole.CLIENT,
      tenantId: null,
    });

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      tenantId: env.DEFAULT_TENANT_ID,
    });
  });

  it('rejects a token when the user is missing or inactive', async () => {
    const strategy = strategyFor(null);

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  describe('alcance entre gimnasios', () => {
    it('deja sin filtro a un SYSTEM_ADMIN que no suplanta', async () => {
      const strategy = strategyFor({
        id: payload.sub,
        email: payload.email,
        role: UserRole.SYSTEM_ADMIN,
        tenantId: 'topfitness',
      });

      await expect(strategy.validate(payload)).resolves.toMatchObject({
        // `null` = todos los gimnasios. Es el único principal que lo alcanza.
        tenantScope: null,
        impersonating: false,
      });
    });

    it('acota a un SYSTEM_ADMIN al gimnasio que suplanta', async () => {
      const strategy = strategyFor({
        id: payload.sub,
        email: payload.email,
        role: UserRole.SYSTEM_ADMIN,
        tenantId: 'topfitness',
      });

      await expect(
        strategy.validate({ ...payload, tenantId: 'gimnasio-vecino' }),
      ).resolves.toMatchObject({
        // El dominio de socio ve el gimnasio mirado sin enterarse de nada más.
        tenantId: 'gimnasio-vecino',
        tenantScope: 'gimnasio-vecino',
        impersonating: true,
      });
    });

    /**
     * El invariante que sostiene todo el diseño: el claim ACOTA un privilegio,
     * nunca lo concede. El rol se comprueba contra la base de datos, así que un
     * token con claim de suplantación no le sirve de nada a una cuenta que no
     * sea SYSTEM_ADMIN — ni filtrado, ni si la cuenta fue degradada después de
     * emitirse el token.
     */
    it('ignora el claim de suplantacion si la cuenta no es SYSTEM_ADMIN', async () => {
      const strategy = strategyFor({
        id: payload.sub,
        email: payload.email,
        role: UserRole.ADMIN,
        tenantId: 'topfitness',
      });

      await expect(
        strategy.validate({ ...payload, tenantId: 'gimnasio-vecino' }),
      ).resolves.toMatchObject({
        tenantId: 'topfitness',
        tenantScope: 'topfitness',
        impersonating: false,
      });
    });
  });
});
