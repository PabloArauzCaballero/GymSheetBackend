import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser, JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersRepository: UsersRepository) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ACCESS_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  /**
   * Revalidates the principal against PostgreSQL for every authenticated request.
   * This prevents deleted, blocked, or role-changed users from continuing to use
   * a previously issued access token until it expires.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const activeUser = await this.usersRepository.findActiveById(payload.sub);

    if (!activeUser) {
      throw new UnauthorizedException('La sesión ya no es válida.');
    }

    // Se lee de la cuenta y no del token: así un cambio de gimnasio surte
    // efecto en la siguiente petición, sin esperar a que caduque la sesión.
    // El respaldo agrupa a las cuentas sin tenant propio bajo el tenant por
    // defecto en vez de dejarlas sin filtro (ver DEFAULT_TENANT_ID en env.ts).
    const ownTenantId = activeUser.tenantId ?? env.DEFAULT_TENANT_ID;
    const isSystemAdmin = activeUser.role === UserRole.SYSTEM_ADMIN;

    // El claim de suplantación se comprueba contra el ROL EN BASE DE DATOS, no
    // contra el del token: acota un privilegio existente, nunca lo concede. Si
    // la cuenta dejó de ser SYSTEM_ADMIN desde que se emitió, el claim se
    // ignora y vuelve a su propio gimnasio en la siguiente petición.
    const impersonating = isSystemAdmin && payload.tenantId !== undefined;
    const effectiveTenantId = impersonating
      ? (payload.tenantId as string)
      : ownTenantId;

    return {
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      tenantId: effectiveTenantId,
      // `null` = sin filtro. Sólo lo alcanza un SYSTEM_ADMIN que no suplanta;
      // cualquier otro principal queda atado a un gimnasio concreto.
      tenantScope: isSystemAdmin && !impersonating ? null : effectiveTenantId,
      impersonating,
    };
  }
}
