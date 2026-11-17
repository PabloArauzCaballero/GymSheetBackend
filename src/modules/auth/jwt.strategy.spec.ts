import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { PENDING_REVIEW_SUSPENSION_UNTIL } from '../../common/moderation/account-suspension';
import { JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { SanctionStatusService } from '../sanction-status/sanction-status.service';
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
    findBusinessEntityId: jest.fn().mockResolvedValue('00000000-0000-4000-8000-0000000000e1'),
  } as unknown as UsersRepository;
  const sanctionStatus = {
    suspensionReason: jest.fn().mockResolvedValue({ code: 'SPAM', label: 'Spam', text: 'publicidad' }),
  } as unknown as SanctionStatusService;
  return new JwtStrategy(usersRepository, sanctionStatus);
}

describe('JwtStrategy', () => {
  it('rejects a suspended account; a pending-review suspension names the review, not a date', async () => {
    const dated = strategyFor({ id: payload.sub, role: UserRole.CLIENT, suspendedUntil: new Date(Date.now() + 86_400_000) });
    await expect(dated.validate(payload)).rejects.toThrow('Tu cuenta está suspendida temporalmente');
    const pending = strategyFor({ id: payload.sub, role: UserRole.CLIENT, suspendedUntil: PENDING_REVIEW_SUSPENSION_UNTIL });
    await expect(pending.validate(payload)).rejects.toThrow('Tu cuenta está suspendida mientras revisamos un reporte.');
  });

  it('tells a suspended session why, in details.reason', async () => {
    const dated = strategyFor({ id: payload.sub, role: UserRole.CLIENT, suspendedUntil: new Date(Date.now() + 86_400_000) });
    const error: unknown = await dated.validate(payload).catch((caught: unknown) => caught);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      details: { pendingReview: false, reason: { code: 'SPAM', label: 'Spam' } },
    });
  });

  it('returns the current persisted role for an active principal', async () => {
    const strategy = strategyFor({
      id: payload.sub,
      email: payload.email,
      role: UserRole.CLIENT,
      tenantId: 'topfitness',
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: payload.sub,
      email: payload.email,
      role: UserRole.CLIENT,
      tenantId: 'topfitness',
      // Una cuenta que no es de plataforma queda atada a su propio gimnasio,
      // nunca a «todos».
      tenantScope: 'topfitness',
      impersonating: false,
      emailVerified: false,
      deviceId: null,
      accountKind: 'PERSON',
      businessEntityId: null,
    });
  });

  it('marks a business account and resolves the listing it owns (ADR-0020)', async () => {
    const strategy = strategyFor({ id: payload.sub, email: payload.email, role: UserRole.BUSINESS, tenantId: 'default' });
    await expect(strategy.validate({ ...payload, role: UserRole.BUSINESS })).resolves.toMatchObject({
      role: UserRole.BUSINESS,
      accountKind: 'BUSINESS',
      businessEntityId: '00000000-0000-4000-8000-0000000000e1',
    });
  });

  it('reports a verified mailbox from the persisted timestamp', async () => {
    const strategy = strategyFor({
      id: payload.sub,
      email: payload.email,
      role: UserRole.CLIENT,
      tenantId: 'topfitness',
      emailVerifiedAt: new Date('2026-11-01T10:00:00Z'),
    });

    await expect(strategy.validate(payload)).resolves.toMatchObject({ emailVerified: true });
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

  it('rejects an access token issued before the account ended all its sessions', async () => {
    const cut = new Date('2026-11-16T12:00:00.500Z');
    const strategy = strategyFor({ id: payload.sub, email: payload.email, role: UserRole.CLIENT, sessionsValidAfter: cut });
    const second = Math.floor(cut.getTime() / 1000);

    // Same second, one millisecond apart: only the token minted after the cut survives.
    await expect(strategy.validate({ ...payload, iat: second, sat: cut.getTime() - 1 })).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ ...payload, iat: second, sat: cut.getTime() + 1 })).resolves.toMatchObject({ id: payload.sub });
    // A token without `sat` (issued before it existed) is judged by the start of its second.
    await expect(strategy.validate({ ...payload, iat: second })).rejects.toThrow(UnauthorizedException);
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
        role: UserRole.MODERATOR,
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
