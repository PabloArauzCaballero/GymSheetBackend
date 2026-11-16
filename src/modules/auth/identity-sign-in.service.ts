import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { RefreshTokenRevokedReason, UserStatus } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import { LEGAL_DOCUMENTS } from "../legal/legal-documents";
import { LegalService } from "../legal/legal.service";
import { TenantsService } from "../tenants/tenants.service";
import { UserModel } from "../users/user.model";
import { UsersRepository } from "../users/users.repository";
import { AuthResponse, AuthSessionService } from "./auth-session.service";
import { IdentitySignupCompletionInput } from "./auth.schemas";
import { ClientDeviceContext } from "./client-device-context";
import { IdentitySignupTokenService } from "./identity-signup-token.service";
import { IdentityRepository } from "./identity.repository";
import { IdentityProvider, OidcTokenVerifier, VerifiedIdentity } from "./oidc-token-verifier";
import { SignupRequestMeta } from "./signup-context";
import { UserDeviceService } from "./user-device.service";
import { SignupProtectionService } from "../antibot/signup-protection.service";
import { ClosedAccountSanctionsService, suspendedAccountError } from "../closed-account-sanctions/closed-account-sanctions.service";

export type IdentitySignInResult =
  | ({ status: "AUTHENTICATED" } & AuthResponse)
  | { status: "PROFILE_COMPLETION_REQUIRED"; signupToken: string; email: string };

const ACCOUNT_EXISTS = "Ya existe una cuenta registrada con este correo.";

/**
 * Google / Apple sign-in. A known subject logs in; an unknown subject whose
 * verified email matches an account is linked to it; anyone else is asked to
 * complete the profile (sex, birth date, terms) before an account exists.
 */
@Injectable()
export class IdentitySignInService {
  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly identities: IdentityRepository,
    private readonly signupTokens: IdentitySignupTokenService,
    private readonly users: UsersRepository,
    private readonly tenants: TenantsService,
    private readonly legal: LegalService,
    private readonly sessions: AuthSessionService,
    private readonly devices: UserDeviceService,
    private readonly signupProtection: SignupProtectionService,
    private readonly sequelize: Sequelize,
    private readonly carriedSanctions: ClosedAccountSanctionsService,
  ) {}

  async signIn(
    provider: IdentityProvider,
    token: string,
    nonce: string | undefined,
    device: ClientDeviceContext,
  ): Promise<IdentitySignInResult> {
    assertEnabled(provider);
    const identity = await this.verifier.verify(provider, token, nonce);

    const linkedUserId = await this.identities.findUserId(provider, identity.subject);
    if (linkedUserId) {
      const user = await this.users.findActiveById(linkedUserId);
      if (!user) throw new UnauthorizedException("Credenciales inválidas.");
      return this.openSession(user, device, null);
    }

    const email = verifiedEmail(identity);
    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (existing.status !== UserStatus.ACTIVE) throw new UnauthorizedException("Credenciales inválidas.");
      // The provider proved this mailbox, which is exactly what the PIN proves.
      // An account that never verified it may have been pre-registered by
      // someone else to hijack it later: the mailbox owner takes it over, so its
      // password and every session that existed before are discarded.
      return this.openSession(existing, device, identity, { takeOver: !existing.emailVerifiedAt });
    }

    return {
      status: "PROFILE_COMPLETION_REQUIRED",
      signupToken: this.signupTokens.issue({ provider, subject: identity.subject, email }),
      email,
    };
  }

  async completeSignup(
    expectedProvider: IdentityProvider,
    input: IdentitySignupCompletionInput,
    meta: SignupRequestMeta,
  ): Promise<IdentitySignInResult> {
    const claims = this.signupTokens.verify(input.signupToken);
    if (claims.provider !== expectedProvider) throw new NotFoundException("Recurso no encontrado.");
    assertEnabled(claims.provider);
    this.legal.assertCurrentTermsVersion(input.termsVersion);
    const tenantId = input.tenantId ?? env.DEFAULT_TENANT_ID;
    if (tenantId) await this.tenants.assertActiveTenant(tenantId);
    if (await this.users.findByEmail(claims.email)) throw new ConflictException(ACCOUNT_EXISTS);

    // No password exists: an unguessable hash keeps the column's contract; the
    // person can still set one later through the password-reset PIN.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), env.BCRYPT_SALT_ROUNDS);
    try {
      const session = await this.sequelize.transaction(async (transaction) => {
        const user = await this.users.createClient(
          {
            email: claims.email,
            passwordHash,
            fullName: input.fullName,
            tenantId: tenantId ?? null,
            gender: input.gender,
            birthDate: input.birthDate,
            acceptedTermsAt: new Date(),
            termsVersion: LEGAL_DOCUMENTS.TERMS,
            emailVerifiedAt: new Date(),
          },
          transaction,
        );
        await this.legal.recordSignupAcceptances(user.id, meta.legal, transaction);
        // The provider vouched for a real, verified email; the signup is still audited.
        const source = claims.provider === "GOOGLE" ? "IDENTITY_GOOGLE" : "IDENTITY_APPLE";
        await this.signupProtection.recordOutcome(
          this.signupProtection.vouchedVerdict(source, meta.legal.channel),
          user.id,
          transaction,
        );
        await this.identities.link(claims.provider, claims.subject, user.id, claims.email, transaction);
        const deviceId = await this.devices.recordSignup(user.id, meta.device, transaction);
        const suspendedUntil = await this.carriedSanctions.inheritAtSignup(user, transaction);
        return suspendedUntil ?? this.sessions.issue(user, { deviceId }, transaction);
      });
      if (session instanceof Date) throw suspendedAccountError(session);
      return { status: "AUTHENTICATED", ...session };
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new ConflictException(ACCOUNT_EXISTS);
      throw error;
    }
  }

  /** Links the identity when given, marks the email verified and issues the session atomically. */
  private async openSession(
    user: UserModel,
    device: ClientDeviceContext,
    identityToLink: VerifiedIdentity | null,
    options: { takeOver?: boolean } = {},
  ): Promise<IdentitySignInResult> {
    if (user.suspendedUntil && user.suspendedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(
        `Tu cuenta está suspendida hasta el ${user.suspendedUntil.toLocaleDateString("es")} por incumplir las normas de la comunidad.`,
      );
    }
    try {
      const session = await this.sequelize.transaction(async (transaction) => {
        if (options.takeOver) {
          const unusable = await bcrypt.hash(randomBytes(32).toString("hex"), env.BCRYPT_SALT_ROUNDS);
          await this.users.updatePasswordHash(user.id, unusable, transaction);
          await this.devices.endAllSessions(user.id, RefreshTokenRevokedReason.PASSWORD_RESET, transaction);
          await this.users.invalidateIssuedSessions(user.id, transaction);
        }
        if (identityToLink) {
          await this.identities.link(identityToLink.provider, identityToLink.subject, user.id, identityToLink.email, transaction);
          await this.users.markEmailVerified(user.id, transaction);
        }
        const deviceId = await this.devices.recordSignIn(user.id, device, transaction);
        return this.sessions.issue(
          { ...summary(user), emailVerifiedAt: user.emailVerifiedAt ?? (identityToLink ? new Date() : null) },
          { deviceId },
          transaction,
        );
      });
      return { status: "AUTHENTICATED", ...session };
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          "IDENTITY_ALREADY_LINKED",
          "Esta cuenta ya está vinculada. Inténtalo de nuevo.",
        );
      }
      throw error;
    }
  }
}

function summary(user: UserModel) {
  return { id: user.id, email: user.email, role: user.role, fullName: user.fullName, tenantId: user.tenantId };
}

function assertEnabled(provider: IdentityProvider): void {
  const enabled = provider === "GOOGLE" ? env.AUTH_GOOGLE_ENABLED : env.AUTH_APPLE_ENABLED;
  if (!enabled) throw new NotFoundException("Recurso no encontrado.");
}

function verifiedEmail(identity: VerifiedIdentity): string {
  if (!identity.email || !identity.emailVerified) {
    throw new DomainException(
      HttpStatus.FORBIDDEN,
      "IDENTITY_EMAIL_UNVERIFIED",
      "Tu cuenta no tiene un correo verificado. Usa otra forma de acceso.",
    );
  }
  return identity.email;
}
