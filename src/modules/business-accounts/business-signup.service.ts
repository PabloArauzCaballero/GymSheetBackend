import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DomainException } from '../../common/errors/domain.exception';
import { suspendedAccountError } from '../../common/moderation/account-suspension';
import { env } from '../../config/env';
import { SignupProtectionService } from '../antibot/signup-protection.service';
import { AuthResponse, AuthSessionService } from '../auth/auth-session.service';
import { EmailVerificationService } from '../auth/email-verification.service';
import { SignupRequestMeta } from '../auth/signup-context';
import { UserDeviceService } from '../auth/user-device.service';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { DirectoryEntityType } from '../directory/directory-entity.model';
import { BUSINESS_LEGAL_TEXTS_ARE_DRAFTS } from '../legal/legal-documents';
import { LegalService } from '../legal/legal.service';
import { SanctionStatusService } from '../sanction-status/sanction-status.service';
import { UsersRepository } from '../users/users.repository';
import { BusinessSummaryDto, mapBusinessSummary } from './business-accounts.mapper';
import { BusinessAccountsRepository } from './business-accounts.repository';
import { BusinessSignupInput, LegalKind } from './business-accounts.schemas';

const FIXED_LEGAL_KIND: Partial<Record<DirectoryEntityType, LegalKind>> = {
  GYM: 'COMPANY',
  CENTER: 'COMPANY',
  STORE: 'COMPANY',
  COACH: 'INDIVIDUAL',
};

/**
 * The signup is open when the flag is on, and never in production while the
 * business legal texts are placeholders (ADR-0020). Read at call time.
 */
export function businessSignupOpen(): boolean {
  if (!env.BUSINESS_SIGNUP_ENABLED) return false;
  return env.NODE_ENV !== 'production' || !BUSINESS_LEGAL_TEXTS_ARE_DRAFTS;
}

/** COACH is a person; GYM/CENTER/STORE are companies; SERVICE_PROVIDER says which. */
export function resolveLegalKind(entityType: DirectoryEntityType, requested?: LegalKind): LegalKind {
  const fixed = FIXED_LEGAL_KIND[entityType];
  const legalKind = fixed ?? requested;
  if (!legalKind || (fixed && requested && requested !== fixed)) {
    throw new DomainException(
      HttpStatus.BAD_REQUEST,
      'BUSINESS_LEGAL_KIND_INVALID',
      fixed ? 'Ese tipo de negocio no admite esa forma legal.' : 'Indica si eres empresa o persona.',
      { allowed: fixed ? [fixed] : ['COMPANY', 'INDIVIDUAL'] },
    );
  }
  return legalKind;
}

function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/(^-|-$)+/gu, '')
    .slice(0, 100);
  return `${base || 'negocio'}-${Date.now().toString(36)}`;
}

/**
 * Business account signup (ADR-0020): the same anti-automation layer, legal
 * evidence, email PIN, inherited sanctions and session as a person, without
 * any person data. One login per business; the listing is born DRAFT.
 */
@Injectable()
export class BusinessSignupService {
  private readonly logger = new Logger(BusinessSignupService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly users: UsersRepository,
    private readonly accounts: BusinessAccountsRepository,
    private readonly legal: LegalService,
    private readonly signupProtection: SignupProtectionService,
    private readonly sessions: AuthSessionService,
    private readonly devices: UserDeviceService,
    private readonly emailVerification: EmailVerificationService,
    private readonly carriedSanctions: ClosedAccountSanctionsService,
    private readonly sanctionStatus: SanctionStatusService,
  ) {}

  async signup(input: BusinessSignupInput, meta: SignupRequestMeta): Promise<AuthResponse & { business: BusinessSummaryDto }> {
    if (!businessSignupOpen()) {
      throw new DomainException(HttpStatus.NOT_FOUND, 'BUSINESS_SIGNUP_DISABLED', 'El alta de negocios todavía no está disponible.');
    }
    this.legal.assertCurrentAcceptances('BUSINESS', input.acceptances);
    const legalKind = resolveLegalKind(input.entityType, input.legalKind);

    // Before the email lookup, as in the person signup: a refused signup must not learn whether the address exists.
    const verdict = await this.signupProtection.evaluate({
      ticket: input.ticket ?? null,
      honeypot: input.website ? input.website : null,
      turnstileToken: input.turnstileToken ?? null,
      attestation: input.attestation ?? null,
      ip: meta.ip,
      userAgent: meta.device.userAgent,
      installationId: meta.device.installationId,
      email: input.email,
      password: input.password,
      channel: meta.legal.channel,
    });
    if (!verdict.allowed) {
      this.logger.warn({ event: 'business.signup_rejected', reason: verdict.reason, risk: verdict.risk, channel: meta.legal.channel });
      throw new DomainException(HttpStatus.BAD_REQUEST, 'SIGNUP_REJECTED', 'No pudimos crear tu cuenta. Inténtalo de nuevo.');
    }
    if (await this.users.findByEmail(input.email)) throw emailTaken();

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);
    try {
      const outcome = await this.sequelize.transaction(async (transaction) => {
        const user = await this.users.createBusiness(
          { email: input.email, passwordHash, fullName: input.businessName, tenantId: env.DEFAULT_TENANT_ID, signupRisk: verdict.risk },
          transaction,
        );
        const entity = await this.accounts.createDraftEntity(
          { slug: slugFor(input.businessName), name: input.businessName, entityType: input.entityType, ownerUserId: user.id },
          transaction,
        );
        await this.accounts.createAccount({ userId: user.id, entityId: entity.id, entityType: input.entityType, legalKind }, transaction);
        await this.legal.recordSignupAcceptances(user.id, meta.legal, transaction, 'BUSINESS');
        await this.signupProtection.recordOutcome(verdict, user.id, transaction);
        const deviceId = await this.devices.recordSignup(user.id, meta.device, transaction);
        await this.emailVerification.issuePin(user.id, transaction);
        const suspendedUntil = await this.carriedSanctions.inheritAtSignup(user, transaction);
        const business = mapBusinessSummary({ entityId: entity.id, entityType: input.entityType, legalKind, status: 'ONBOARDING', kycStatus: 'DRAFT' });
        if (suspendedUntil) return { suspended: true as const, userId: user.id, suspendedUntil };
        return { suspended: false as const, session: await this.sessions.issue(user, { deviceId }, transaction), business };
      });
      if (outcome.suspended) {
        throw suspendedAccountError(outcome.suspendedUntil, await this.sanctionStatus.suspensionReason(outcome.userId, outcome.suspendedUntil));
      }
      this.logger.log({ event: 'business.signup_completed', userId: outcome.session.user.id, entityType: input.entityType });
      return { ...outcome.session, business: outcome.business };
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError && 'email' in (error.fields ?? {})) throw emailTaken();
      throw error;
    }
  }
}

function emailTaken(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta registrada con este correo.');
}
