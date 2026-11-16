import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize-typescript';
import { UniqueConstraintError } from 'sequelize';
import { RefreshTokenRevokedReason, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser, JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { SignupProtectionService } from '../antibot/signup-protection.service';
import { suspendedAccountError } from '../../common/moderation/account-suspension';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersRepository } from '../users/users.repository';
import { LEGAL_DOCUMENTS } from '../legal/legal-documents';
import { LegalService } from '../legal/legal.service';
import { AuthResponse, AuthSessionService } from './auth-session.service';
import { ImpersonateTenantInput, LoginInput, RegisterInput } from './auth.schemas';
import { ClientDeviceContext } from './client-device-context';
import { EmailVerificationService } from './email-verification.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { SignupRequestMeta, toSignupContext } from './signup-context';
import { hashOpaqueToken } from './token-hash.util';
import { UserDeviceService } from './user-device.service';

export type { AuthResponse } from './auth-session.service';

/**
 * Decoy hash compared against when no account matches the submitted email.
 * Generated at load time with the configured cost factor so the fallback
 * comparison takes the same time as a real one.
 */
const UNKNOWN_ACCOUNT_PASSWORD_HASH = bcrypt.hashSync(
  'unknown-account-placeholder',
  env.BCRYPT_SALT_ROUNDS,
);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tenantsService: TenantsService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly jwtService: JwtService,
    private readonly sequelize: Sequelize,
    private readonly legalService: LegalService,
    private readonly sessions: AuthSessionService,
    private readonly devices: UserDeviceService,
    private readonly emailVerification: EmailVerificationService,
    private readonly signupProtection: SignupProtectionService,
    private readonly carriedSanctions: ClosedAccountSanctionsService,
  ) {}

  async register(input: RegisterInput, meta: SignupRequestMeta): Promise<AuthResponse> {
    // First: a client showing outdated legal text must not create an account
    // whose acceptance record would point at a version the person never read.
    this.legalService.assertCurrentTermsVersion(input.termsVersion);

    // El gimnasio que declara el cliente se comprueba contra el catálogo antes
    // de nada. Mientras `tenant_id` fue texto libre validado sólo por su forma,
    // el registro —que es público— dejaba entrar a cualquiera al perímetro de
    // cualquier gimnasio cuya clave conociera o adivinara: directorio de
    // socios, chat, stories y clasificación (H-03).
    const requestedTenantId = input.tenantId ?? env.DEFAULT_TENANT_ID;
    if (requestedTenantId) {
      await this.tenantsService.assertActiveTenant(requestedTenantId);
    }

    // Before the email lookup: a refused signup must not learn whether the
    // address exists. The reason is logged, never shown to the client.
    const verdict = meta.internal
      ? this.signupProtection.vouchedVerdict('INTERNAL_SEED', meta.legal.channel)
      : await this.signupProtection.evaluate(toSignupContext(input, meta));
    if (!verdict.allowed) {
      this.logger.warn({
        event: 'auth.signup_rejected',
        reason: verdict.reason,
        risk: verdict.risk,
        channel: meta.legal.channel,
      });
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        'SIGNUP_REJECTED',
        'No pudimos crear tu cuenta. Inténtalo de nuevo.',
      );
    }

    const existingUser = await this.usersRepository.findByEmail(input.email);

    if (existingUser) {
      throw new ConflictException('Ya existe una cuenta registrada con este correo.');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

    try {
      // Account, legal acceptances, signup audit, device, first email PIN and
      // session commit together: an account must never exist without the
      // evidence of what it accepted, nor half-created without its PIN.
      const session = await this.sequelize.transaction(async (transaction) => {
        const user = await this.usersRepository.createClient({
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          // El cliente manda cuando sabe por dónde entró la persona; si no, la
          // instalación decide. Lo que ya no ocurre es quedarse sin gimnasio: eso
          // dejaba a la cuenta sin marca y a la aplicación pintando la genérica.
          tenantId: requestedTenantId ?? null,
          gender: input.gender,
          birthDate: input.birthDate,
          // Legacy columns kept for compatibility; the audit trail is auth.terms_acceptances.
          acceptedTermsAt: new Date(),
          termsVersion: LEGAL_DOCUMENTS.TERMS,
          signupRisk: verdict.risk,
        }, transaction);
        await this.legalService.recordSignupAcceptances(user.id, meta.legal, transaction);
        await this.signupProtection.recordOutcome(verdict, user.id, transaction);
        const deviceId = await this.devices.recordSignup(user.id, meta.device, transaction);
        await this.emailVerification.issuePin(user.id, transaction);
        const suspendedUntil = await this.carriedSanctions.inheritAtSignup(user, transaction);
        return suspendedUntil ?? this.sessions.issue(user, { deviceId }, transaction);
      });
      if (session instanceof Date) throw suspendedAccountError(session);
      return session;
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('Ya existe una cuenta registrada con este correo.');
      }

      throw error;
    }
  }

  async login(input: LoginInput, device: ClientDeviceContext): Promise<AuthResponse> {
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

    // Después de comprobar la contraseña, nunca antes: avisar de la suspensión
    // a quien no ha demostrado ser el dueño de la cuenta convertiría el login
    // en un detector de cuentas sancionadas para cualquiera que pruebe correos.
    //
    // 403 y no 401: la contraseña era correcta. Con 401 los clientes —que
    // traducen todo 401 del acceso a «credenciales inválidas»— le decían a la
    // persona suspendida que se había equivocado de contraseña, y el motivo y
    // la fecha que escribimos aquí no llegaban nunca a la pantalla.
    if (activeUser.suspendedUntil && activeUser.suspendedUntil.getTime() > Date.now()) {
      throw suspendedAccountError(activeUser.suspendedUntil);
    }

    return this.sequelize.transaction(async (transaction) => {
      const deviceId = await this.devices.recordSignIn(activeUser.id, device, transaction);
      return this.sessions.issue(activeUser, { deviceId }, transaction);
    });
  }

  /**
   * Rotates a refresh token: the presented one is revoked and a new one
   * takes its place in the same family. Presenting a token that is already
   * revoked is a reuse signal — the legitimate holder should only ever have
   * the newest one in its chain — so the whole family is revoked instead of
   * just failing the one request, cutting off a stolen token even if it was
   * captured after already being rotated once.
   */
  async refresh(rawRefreshToken: string, device: ClientDeviceContext): Promise<AuthResponse> {
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
      // A session bound to a revoked device dies here, even if its token row
      // somehow escaped the revocation sweep.
      const deviceId = await this.devices.resolveForRefresh(
        activeUser.id,
        existingToken.deviceId ?? null,
        device,
        transaction,
      );
      await this.refreshTokenRepository.revoke(
        existingToken.id,
        RefreshTokenRevokedReason.ROTATED,
        transaction,
      );
      return this.sessions.issue(
        activeUser,
        { familyId: existingToken.familyId, deviceId },
        transaction,
      );
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

  /**
   * Los campos del principal se conservan tal cual (`role`, `tenantScope`…):
   * hay clientes que ya los leen. `nombreCompleto` y `rol` se añaden con los
   * mismos nombres que usa `user` en login/registro/refresh.
   */
  async me(principal: AuthenticatedUser) {
    const account = await this.usersRepository.findActiveById(principal.id);
    return {
      ...principal,
      rol: principal.role,
      nombreCompleto: account?.fullName ?? '',
      emailVerified: Boolean(account?.emailVerifiedAt),
      verified: Boolean(account?.verifiedAt),
    };
  }
}
