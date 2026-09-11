import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Sequelize } from 'sequelize-typescript';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { RefreshTokenRevokedReason, UserRole } from '../../common/enums/domain.enums';
import { parseDurationToMs } from '../../common/time/duration.util';
import { AuthenticatedUser, JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { TenantsService } from '../tenants/tenants.service';
import { UsersRepository } from '../users/users.repository';
import {
  CURRENT_TERMS_VERSION,
  ImpersonateTenantInput,
  LoginInput,
  RegisterInput,
} from './auth.schemas';
import { RefreshTokenRepository } from './refresh-token.repository';
import { hashOpaqueToken, issueOpaqueToken } from './token-hash.util';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tenantsService: TenantsService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly jwtService: JwtService,
    private readonly sequelize: Sequelize,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    // El gimnasio que declara el cliente se comprueba contra el catálogo antes
    // de nada. Mientras `tenant_id` fue texto libre validado sólo por su forma,
    // el registro —que es público— dejaba entrar a cualquiera al perímetro de
    // cualquier gimnasio cuya clave conociera o adivinara: directorio de
    // socios, chat, stories y clasificación (H-03).
    const requestedTenantId = input.tenantId ?? env.DEFAULT_TENANT_ID;
    if (requestedTenantId) {
      await this.tenantsService.assertActiveTenant(requestedTenantId);
    }

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
        // El cliente manda cuando sabe por dónde entró la persona; si no, la
        // instalación decide. Lo que ya no ocurre es quedarse sin gimnasio: eso
        // dejaba a la cuenta sin marca y a la aplicación pintando la genérica.
        tenantId: requestedTenantId ?? null,
        gender: input.gender,
        // La validación de `acceptedTerms` ya ocurrió en el schema (rechaza el
        // registro si falta); aquí solo queda registrar cuándo y qué versión.
        acceptedTermsAt: new Date(),
        termsVersion: CURRENT_TERMS_VERSION,
      });

      return {
        ...this.buildAuthResponse(
          createdUser.id,
          createdUser.email,
          createdUser.role,
          createdUser.fullName,
          createdUser.tenantId,
        ),
        refreshToken: await this.issueRefreshToken(createdUser.id),
      };
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

    return {
      ...this.buildAuthResponse(
        activeUser.id,
        activeUser.email,
        activeUser.role,
        activeUser.fullName,
        activeUser.tenantId,
      ),
      refreshToken: await this.issueRefreshToken(activeUser.id),
    };
  }

  /**
   * Rotates a refresh token: the presented one is revoked and a new one
   * takes its place in the same family. Presenting a token that is already
   * revoked is a reuse signal — the legitimate holder should only ever have
   * the newest one in its chain — so the whole family is revoked instead of
   * just failing the one request, cutting off a stolen token even if it was
   * captured after already being rotated once.
   */
  async refresh(rawRefreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashOpaqueToken('refresh', rawRefreshToken);
    const existingToken = await this.refreshTokenRepository.findByHash(tokenHash);

    if (!existingToken) {
      throw new UnauthorizedException('Sesión inválida.');
    }

    if (existingToken.revokedAt) {
      await this.refreshTokenRepository.revokeFamily(
        existingToken.familyId,
        RefreshTokenRevokedReason.REUSE_DETECTED,
      );
      throw new UnauthorizedException('Sesión inválida.');
    }

    if (existingToken.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sesión inválida.');
    }

    // Revalidated against the database rather than trusted from the old
    // token's claims, so a role change or deactivation since it was issued
    // takes effect immediately instead of at next login.
    const activeUser = await this.usersRepository.findActiveById(existingToken.userId);
    if (!activeUser) {
      throw new UnauthorizedException('Sesión inválida.');
    }

    return this.sequelize.transaction(async (transaction) => {
      await this.refreshTokenRepository.revoke(
        existingToken.id,
        RefreshTokenRevokedReason.ROTATED,
        transaction,
      );
      const refreshToken = await this.issueRefreshToken(
        activeUser.id,
        existingToken.familyId,
        transaction,
      );

      return {
        ...this.buildAuthResponse(
          activeUser.id,
          activeUser.email,
          activeUser.role,
          activeUser.fullName,
          activeUser.tenantId,
        ),
        refreshToken,
      };
    });
  }

  /** Idempotent by design: revoking an unknown or already-revoked token is a
   * silent no-op, the same outcome a caller sees on success. */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashOpaqueToken('refresh', rawRefreshToken);
    const existingToken = await this.refreshTokenRepository.findByHash(tokenHash);
    if (!existingToken || existingToken.revokedAt) return;

    await this.refreshTokenRepository.revoke(existingToken.id, RefreshTokenRevokedReason.LOGOUT);
  }

  /**
   * Canjea un token acotado al gimnasio que un `SYSTEM_ADMIN` quiere mirar.
   *
   * El rol se conserva —sigue siendo super-admin, sólo que mirando un gimnasio
   * concreto— y el gimnasio viaja como claim, nunca como parámetro de cada
   * petición: así `@CurrentUser().tenantId` es siempre la respuesta y no hay
   * una rama de override que olvidar en uno de los cincuenta endpoints admin.
   *
   * No emite refresh a propósito. Un refresh devuelve a la sesión real, de modo
   * que la suplantación caduca sola y nunca sobrevive en silencio a la rotación
   * de sesión.
   */
  async impersonateTenant(
    actor: AuthenticatedUser,
    input: ImpersonateTenantInput,
  ): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    tenantId: string;
    expiresIn: string;
  }> {
    if (actor.role !== UserRole.SYSTEM_ADMIN) {
      throw new ForbiddenException('Solo un administrador de plataforma puede suplantar un gimnasio.');
    }

    // Contra el catálogo: suplantar un gimnasio inexistente crearía una sesión
    // apuntando a un perímetro que no existe, y todo listado saldría vacío sin
    // que nada explicara por qué.
    await this.tenantsService.assertActiveTenant(input.tenantId);

    const accessToken = this.jwtService.sign(
      {
        sub: actor.id,
        email: actor.email,
        role: actor.role,
        tenantId: input.tenantId,
      } satisfies JwtPayload,
      {
        secret: env.JWT_ACCESS_SECRET,
        expiresIn: env.JWT_IMPERSONATION_EXPIRES_IN,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        algorithm: 'HS256',
      },
    );

    // Rastro de auditoría: un privilegio supra-gimnasio que se ejerce sin dejar
    // constancia de quién, sobre qué y cuándo es exactamente lo que impide
    // reconstruir un incidente despues.
    this.logger.warn({
      event: 'auth.tenant_impersonated',
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetTenantId: input.tenantId,
      expiresIn: env.JWT_IMPERSONATION_EXPIRES_IN,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      tenantId: input.tenantId,
      expiresIn: env.JWT_IMPERSONATION_EXPIRES_IN,
    };
  }

  private buildAuthResponse(
    userId: string,
    emailAddress: string,
    role: JwtPayload['role'],
    fullName: string,
    tenantId: string | null,
  ): Omit<AuthResponse, 'refreshToken'> {
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
      tokenType: 'Bearer',
      user: {
        id: userId,
        email: emailAddress,
        nombreCompleto: fullName,
        rol: role,
        // Las cuentas creadas antes de existir el campo no tienen gimnasio
        // guardado. Se resuelven aquí contra la instalación en vez de
        // reescribirlas en masa: una migración que asignara marca a treinta
        // cuentas existentes sería una decisión de negocio disfrazada de esquema.
        tenantId: tenantId ?? env.DEFAULT_TENANT_ID ?? null,
      },
    };
  }

  private async issueRefreshToken(
    userId: string,
    familyId: string = randomUUID(),
    transaction?: Transaction,
  ): Promise<string> {
    const { rawToken, tokenHash } = issueOpaqueToken('refresh');
    const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));
    await this.refreshTokenRepository.create({ userId, familyId, tokenHash, expiresAt }, transaction);
    return rawToken;
  }
}
