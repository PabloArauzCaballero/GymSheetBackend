import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import { UserGender, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { SignupProtectionService } from '../antibot/signup-protection.service';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { SanctionStatusService } from '../sanction-status/sanction-status.service';
import type { SignupVerdict } from '../antibot/signup-protection.types';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_CONTENT_SHA256 } from '../legal/legal-documents';
import { LegalRepository } from '../legal/legal.repository';
import { LegalService } from '../legal/legal.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersRepository } from '../users/users.repository';
import { AuthSessionService } from './auth-session.service';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { SignupRequestMeta } from './signup-context';
import { UserDeviceService } from './user-device.service';

const meta: SignupRequestMeta = {
  legal: { channel: 'ANDROID', ipHmac: null, userAgent: 'jest' },
  device: {
    installationId: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
    platform: 'ANDROID',
    appVersion: '2.4.0',
    osVersion: '15',
    deviceModel: 'Pixel 8',
    userAgent: 'jest',
    ipHmac: null,
  },
  ip: '203.0.113.7',
};
const transaction = { id: 'signup-transaction' };
const input = {
  email: 'ana@example.test',
  password: 'clave-segura-1',
  fullName: 'Ana Prueba',
  gender: UserGender.FEMALE as UserGender.FEMALE,
  birthDate: '1995-05-15',
  termsVersion: LEGAL_DOCUMENTS.TERMS,
  ticket: 'signed-ticket',
  website: '',
};

function verdict(overrides: Partial<SignupVerdict> = {}): SignupVerdict {
  return {
    allowed: true,
    reason: null,
    risk: 'MEDIUM',
    riskReasons: ['IP_VELOCITY'],
    startedAt: new Date('2026-11-16T10:00:00Z'),
    durationMs: 12_000,
    ticketId: 'ticket-1',
    ...overrides,
  };
}

function build(decision: SignupVerdict = verdict(), inheritedSuspension: Date | null = null) {
  const createClient = jest.fn().mockResolvedValue({
    id: 'user-1',
    email: input.email,
    role: UserRole.CLIENT,
    fullName: input.fullName,
    tenantId: null,
    emailVerifiedAt: null,
  });
  const findByEmail = jest.fn().mockResolvedValue(null);
  const insertAcceptances = jest.fn().mockResolvedValue(undefined);
  const refreshCreate = jest.fn().mockResolvedValue(undefined);
  const evaluate = jest.fn().mockResolvedValue(decision);
  const recordOutcome = jest.fn().mockResolvedValue(undefined);
  const recordSignup = jest.fn().mockResolvedValue('device-1');
  const issuePin = jest.fn().mockResolvedValue(undefined);
  const inheritAtSignup = jest.fn().mockResolvedValue(inheritedSuspension);
  const suspensionReason = jest.fn().mockResolvedValue({ code: 'SPAM', label: 'Spam', text: 'publicidad' });
  const jwt = { sign: jest.fn().mockReturnValue('access-token') } as unknown as JwtService;
  const refreshTokens = { create: refreshCreate } as unknown as RefreshTokenRepository;
  const service = new AuthService(
    { findByEmail, createClient } as unknown as UsersRepository,
    { assertActiveTenant: jest.fn() } as unknown as TenantsService,
    refreshTokens,
    jwt,
    { transaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)) } as unknown as Sequelize,
    new LegalService({ insertAcceptances } as unknown as LegalRepository),
    new AuthSessionService(jwt, refreshTokens),
    { recordSignup } as unknown as UserDeviceService,
    { issuePin } as unknown as EmailVerificationService,
    { evaluate, recordOutcome } as unknown as SignupProtectionService,
    { inheritAtSignup } as unknown as ClosedAccountSanctionsService,
    { suspensionReason } as unknown as SanctionStatusService,
  );
  return {
    service, createClient, findByEmail, insertAcceptances, refreshCreate,
    evaluate, recordOutcome, recordSignup, issuePin, inheritAtSignup, suspensionReason,
  };
}

describe('AuthService.register legal acceptance', () => {
  it('rejects an outdated terms version before creating anything', async () => {
    const { service, createClient } = build();
    const outcome = service.register({ ...input, termsVersion: '2000-01-01' }, meta);
    await expect(outcome).rejects.toBeInstanceOf(DomainException);
    await expect(outcome).rejects.toMatchObject({ code: 'TERMS_VERSION_OUTDATED' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('stores the birth date and sex on the account and records every document in the same transaction', async () => {
    const { service, createClient, insertAcceptances } = build();
    await service.register(input, meta);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        birthDate: '1995-05-15',
        gender: UserGender.FEMALE,
        termsVersion: LEGAL_DOCUMENTS.TERMS,
      }),
      transaction,
    );
    expect(insertAcceptances).toHaveBeenCalledWith(
      'user-1',
      [
        { document: 'TERMS', version: LEGAL_DOCUMENTS.TERMS, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.TERMS },
        { document: 'PRIVACY', version: LEGAL_DOCUMENTS.PRIVACY, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.PRIVACY },
        { document: 'COMMUNITY', version: LEGAL_DOCUMENTS.COMMUNITY, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.COMMUNITY },
      ],
      meta.legal,
      transaction,
    );
  });
});

describe('AuthService.register signup protection', () => {
  it('hands antibot what the request carried', async () => {
    const { service, evaluate } = build();
    await service.register(input, meta);
    expect(evaluate).toHaveBeenCalledWith({
      ticket: 'signed-ticket',
      honeypot: null,
      turnstileToken: null,
      attestation: null,
      ip: '203.0.113.7',
      userAgent: 'jest',
      installationId: meta.device.installationId,
      email: input.email,
      password: input.password,
      channel: 'ANDROID',
    });
  });

  it('refuses with a generic SIGNUP_REJECTED and never reveals the reason nor creates anything', async () => {
    const { service, createClient, findByEmail, recordOutcome } = build(
      verdict({ allowed: false, reason: 'HONEYPOT', risk: 'HIGH' }),
    );
    const error = await service.register({ ...input, website: 'http://spam' }, meta).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({ code: 'SIGNUP_REJECTED' });
    expect(JSON.stringify((error as DomainException).getResponse())).not.toContain('HONEYPOT');
    expect((error as DomainException).message).toBe('No pudimos crear tu cuenta. Inténtalo de nuevo.');
    // Not even the email lookup: a refused bot must not learn which addresses exist.
    expect(findByEmail).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('stores the risk, records the outcome, the device, the first PIN and the session in one transaction', async () => {
    const decision = verdict();
    const { service, createClient, recordOutcome, recordSignup, issuePin, refreshCreate } = build(decision);
    const response = await service.register(input, meta);

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ signupRisk: 'MEDIUM' }), transaction);
    expect(recordOutcome).toHaveBeenCalledWith(decision, 'user-1', transaction);
    expect(recordSignup).toHaveBeenCalledWith('user-1', meta.device, transaction);
    expect(issuePin).toHaveBeenCalledWith('user-1', transaction);
    expect(refreshCreate).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-1' }), transaction);
    expect(response.user.emailVerified).toBe(false);
  });
});

describe('AuthService.register after a sanctioned closure', () => {
  it('inherits the sanction in the signup transaction and refuses the session while suspended', async () => {
    const until = new Date(Date.now() + 3 * 86_400_000);
    const { service, inheritAtSignup, refreshCreate, createClient, suspensionReason } = build(verdict(), until);
    await expect(service.register(input, meta)).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_SUSPENDED',
      details: { until: until.toISOString(), reason: { code: 'SPAM' } },
    });
    expect(suspensionReason).toHaveBeenCalledWith('user-1', until);
    expect(inheritAtSignup).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1', email: input.email }), transaction);
    expect(createClient).toHaveBeenCalled();
    expect(refreshCreate).not.toHaveBeenCalled();
  });

  it('opens the session when nothing is inherited', async () => {
    const { service, inheritAtSignup, refreshCreate } = build();
    await expect(service.register(input, meta)).resolves.toMatchObject({ accessToken: 'access-token' });
    expect(inheritAtSignup).toHaveBeenCalledTimes(1);
    expect(refreshCreate).toHaveBeenCalled();
  });
});
