import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UniqueConstraintError } from 'sequelize';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';
import { LoginInput, RegisterInput } from './auth.schemas';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Decoy hash compared against when no account matches the submitted email.
 * Generated at load time with the configured cost factor so the fallback
 * comparison takes the same time as a real one.
 */
const UNKNOWN_ACCOUNT_PASSWORD_HASH = bcrypt.hashSync(
  'unknown-account-placeholder',
  env.BCRYPT_SALT_ROUNDS,
);

export type AuthResponse = {
  accessToken: string;
  /**
   * Opaque, single-use token for `POST /auth/refresh`. Every refresh returns a
   * new one; the session ends after `JWT_REFRESH_EXPIRES_IN` without use.
   */
  refreshToken: string;
  tokenType: 'Bearer';
  user: {
    id: string;
    email: string;
    nombreCompleto: string;
    rol: UserRole;
    /** Gimnasio de la cuenta; el cliente móvil pinta su marca a partir de esto. */
    tenantId: string | null;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existingUser = await this.usersRepository.findByEmail(input.email);

    if (existingUser) {
      throw new ConflictException('Ya existe una cuenta registrada con este correo.');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

    try {
      const createdUser = await this.usersRepository.createClient({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
      });

      return this.buildAuthResponse(
        createdUser.id,
        createdUser.email,
        createdUser.role,
        createdUser.fullName,
        createdUser.tenantId,
        await this.refreshTokens.issueForNewSession(createdUser.id),
      );
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('Ya existe una cuenta registrada con este correo.');
      }

      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const activeUser = await this.usersRepository.findActiveByEmail(input.email);

    // Always spend the cost of one bcrypt comparison, even when no account
    // matches. Returning early for unknown emails made the response measurably
    // faster than for known ones, which let an unauthenticated caller confirm
    // whether an address is registered by timing alone.
    const passwordMatches = await bcrypt.compare(
      input.password,
      activeUser?.passwordHash ?? UNKNOWN_ACCOUNT_PASSWORD_HASH,
    );

    if (!activeUser || !passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.buildAuthResponse(
      activeUser.id,
      activeUser.email,
      activeUser.role,
      activeUser.fullName,
      activeUser.tenantId,
      await this.refreshTokens.issueForNewSession(activeUser.id),
    );
  }

  /**
   * Exchanges a refresh token for a new access + refresh pair (rotation).
   * The account is re-read so a blocked user cannot renew, and the response
   * carries the current role and gym, same as `/auth/me`.
   */
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const rotated = await this.refreshTokens.rotate(
      refreshToken,
      async (userId) => (await this.usersRepository.findActiveById(userId)) !== null,
    );
    const activeUser = await this.usersRepository.findActiveById(rotated.userId);
    if (!activeUser) {
      throw new UnauthorizedException('La sesión ya no es válida. Inicie sesión de nuevo.');
    }
    return this.buildAuthResponse(
      activeUser.id,
      activeUser.email,
      activeUser.role,
      activeUser.fullName,
      activeUser.tenantId,
      rotated.refreshToken,
    );
  }

  /** Ends the session of [refreshToken]. Idempotent. */
  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    return { revoked: await this.refreshTokens.revokeSession(refreshToken) };
  }

  private buildAuthResponse(
    userId: string,
    emailAddress: string,
    role: JwtPayload['role'],
    fullName: string,
    tenantId: string | null,
    refreshToken: string,
  ): AuthResponse {
    const payload: JwtPayload = {
      sub: userId,
      email: emailAddress,
      role,
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithm: 'HS256',
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      user: {
        id: userId,
        email: emailAddress,
        nombreCompleto: fullName,
        rol: role,
        tenantId,
      },
    };
  }
}
