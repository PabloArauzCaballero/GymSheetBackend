import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
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

    return {
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
    };
  }
}
