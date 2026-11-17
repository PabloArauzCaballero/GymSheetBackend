import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PENDING_REVIEW_SUSPENSION_UNTIL } from '../../common/moderation/account-suspension';
import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import { UserGender, UserRole, UserStatus } from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { LEGAL_DOCUMENTS } from '../legal/legal-documents';
import { LegalService } from '../legal/legal.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersRepository } from '../users/users.repository';
import { AuthSessionService } from './auth-session.service';
import { ClientDeviceContext } from './client-device-context';
import { IdentitySignInService } from './identity-sign-in.service';
import { IdentitySignupTokenService } from './identity-signup-token.service';
import { IdentityRepository } from './identity.repository';
import { OidcTokenVerifier, VerifiedIdentity } from './oidc-token-verifier';
import { SignupRequestMeta } from './signup-context';
import { UserDeviceService } from './user-device.service';
import { SignupProtectionService } from '../antibot/signup-protection.service';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { SanctionStatusService } from '../sanction-status/sanction-status.service';

const transaction = { id: 'tx' };
const device: ClientDeviceContext = {
  installationId: null,
  platform: 'IOS',
  appVersion: null,
  osVersion: null,
  deviceModel: null,
  userAgent: null,
  ipHmac: null,
};
const meta: SignupRequestMeta = { legal: { channel: 'IOS', ipHmac: null, userAgent: null }, device, ip: null };
const identity: VerifiedIdentity = { provider: 'GOOGLE', subject: 'sub-1', email: 'ana@gmail.com', emailVerified: true };
const account = {
  id: 'user-1',
  email: 'ana@gmail.com',
  role: UserRole.CLIENT,
  fullName: 'Ana',
  tenantId: null,
  status: UserStatus.ACTIVE,
  suspendedUntil: null,
  emailVerifiedAt: null,
};

const spam = { code: 'SPAM', label: 'Spam', text: 'publicidad o mensajes repetidos que nadie pidió' };

function build(options: { linkedUserId?: string | null; byEmail?: unknown; byId?: unknown; verified?: VerifiedIdentity; inherited?: Date; banned?: boolean } = {}) {
  const jwt = new JwtService();
  const signupTokens = new IdentitySignupTokenService(jwt);
  const identities = {
    findUserId: jest.fn().mockResolvedValue(options.linkedUserId ?? null),
    link: jest.fn().mockResolvedValue(undefined),
  };
  const users = {
    findActiveById: jest.fn().mockResolvedValue(account),
    findById: jest.fn().mockResolvedValue(options.byId ?? account),
    findByEmail: jest.fn().mockResolvedValue(options.byEmail ?? null),
    markEmailVerified: jest.fn().mockResolvedValue(undefined),
    updatePasswordHash: jest.fn().mockResolvedValue(undefined),
    invalidateIssuedSessions: jest.fn().mockResolvedValue(undefined),
    createClient: jest.fn().mockResolvedValue({ ...account, id: 'user-new', emailVerifiedAt: new Date() }),
  };
  const legal = { assertCurrentTermsVersion: jest.fn(), recordSignupAcceptances: jest.fn().mockResolvedValue(undefined) };
  const refreshTokens = { create: jest.fn().mockResolvedValue(undefined) };
  const devices = {
    recordSignIn: jest.fn().mockResolvedValue('device-1'),
    recordSignup: jest.fn().mockResolvedValue('device-1'),
    endAllSessions: jest.fn().mockResolvedValue(undefined),
  };
  const sanctions = { inheritAtSignup: jest.fn().mockResolvedValue(options.inherited ?? null) };
  const sanctionStatus = {
    suspensionReason: jest.fn().mockResolvedValue(spam),
    banReason: jest.fn().mockResolvedValue(options.banned ? spam : null),
  };
  const signupProtection = {
    vouchedVerdict: jest.fn((source: string) => ({ allowed: true, risk: 'LOW', riskReasons: [source] })),
    recordOutcome: jest.fn().mockResolvedValue(undefined),
  };
  const service = new IdentitySignInService(
    { verify: jest.fn().mockResolvedValue(options.verified ?? identity) } as unknown as OidcTokenVerifier,
    identities as unknown as IdentityRepository,
    signupTokens,
    users as unknown as UsersRepository,
    { assertActiveTenant: jest.fn() } as unknown as TenantsService,
    legal as unknown as LegalService,
    new AuthSessionService(jwt, refreshTokens as never),
    devices as unknown as UserDeviceService,
    signupProtection as unknown as SignupProtectionService,
    { transaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)) } as unknown as Sequelize,
    sanctions as unknown as ClosedAccountSanctionsService,
    sanctionStatus as unknown as SanctionStatusService,
  );
  return { service, identities, users, legal, devices, signupTokens, signupProtection, sanctions, refreshTokens, sanctionStatus };
}

const completion = (signupToken: string) => ({
  signupToken,
  fullName: 'Ana Prueba',
  gender: UserGender.FEMALE as UserGender.FEMALE,
  birthDate: '1995-05-15',
  termsVersion: LEGAL_DOCUMENTS.TERMS,
});

describe('IdentitySignInService', () => {
  beforeEach(() => {
    jest.replaceProperty(env, 'AUTH_GOOGLE_ENABLED', true);
    jest.replaceProperty(env, 'AUTH_APPLE_ENABLED', false);
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers 404 while the provider flag is off', async () => {
    const { service } = build();
    await expect(service.signIn('APPLE', 'token', undefined, device)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('logs in a known subject and records the device', async () => {
    const { service, devices } = build({ linkedUserId: 'user-1' });
    const result = await service.signIn('GOOGLE', 'token', undefined, device);
    expect(result.status).toBe('AUTHENTICATED');
    expect(devices.recordSignIn).toHaveBeenCalledWith('user-1', device, transaction);
  });

  it('links an existing account with the same verified email and marks it verified', async () => {
    const { service, identities, users } = build({ byEmail: account });
    const result = await service.signIn('GOOGLE', 'token', undefined, device);
    expect(identities.link).toHaveBeenCalledWith('GOOGLE', 'sub-1', 'user-1', 'ana@gmail.com', transaction);
    expect(users.markEmailVerified).toHaveBeenCalledWith('user-1', transaction);
    expect(result).toMatchObject({ status: 'AUTHENTICATED', user: { emailVerified: true } });
  });

  it('takes over an account that never verified its email: old password and sessions are discarded', async () => {
    // Pre-hijacking: someone registered the victim's address with a password and never verified it.
    const { service, users, devices, identities } = build({ byEmail: { ...account, emailVerifiedAt: null } });
    await service.signIn('GOOGLE', 'token', undefined, device);
    expect(users.updatePasswordHash).toHaveBeenCalledWith('user-1', expect.stringMatching(/^\$2[aby]\$/u), transaction);
    expect(devices.endAllSessions).toHaveBeenCalledWith('user-1', 'PASSWORD_RESET', transaction);
    expect(users.invalidateIssuedSessions).toHaveBeenCalledWith('user-1', transaction);
    expect(identities.link).toHaveBeenCalled();
  });

  it('links an already verified account without touching its password or sessions', async () => {
    const { service, users, devices } = build({ byEmail: { ...account, emailVerifiedAt: new Date() } });
    await service.signIn('GOOGLE', 'token', undefined, device);
    expect(users.updatePasswordHash).not.toHaveBeenCalled();
    expect(devices.endAllSessions).not.toHaveBeenCalled();
    expect(users.invalidateIssuedSessions).not.toHaveBeenCalled();
  });

  it('refuses to link through an unverified Google email', async () => {
    const { service, identities } = build({ byEmail: account, verified: { ...identity, emailVerified: false } });
    await expect(service.signIn('GOOGLE', 'token', undefined, device)).rejects.toMatchObject({
      code: 'IDENTITY_EMAIL_UNVERIFIED',
    });
    expect(identities.link).not.toHaveBeenCalled();
  });

  it('keeps the suspension rule of the password login', async () => {
    const { service } = build({
      byEmail: { ...account, suspendedUntil: new Date(Date.now() + 86_400_000) },
    });
    await expect(service.signIn('GOOGLE', 'token', undefined, device)).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      status: 403,
      details: { reason: spam },
    });
  });

  it('tells a banned account, linked or matched by email, that it was banned and why', async () => {
    const inactive = { ...account, status: UserStatus.INACTIVE };
    const linked = build({ linkedUserId: 'user-1', byId: inactive, banned: true });
    await expect(linked.service.signIn('GOOGLE', 'token', undefined, device)).rejects.toMatchObject({
      code: 'ACCOUNT_BANNED',
      status: 403,
      details: { reason: spam },
    });
    const byEmail = build({ byEmail: inactive, banned: true });
    await expect(byEmail.service.signIn('GOOGLE', 'token', undefined, device)).rejects.toMatchObject({ code: 'ACCOUNT_BANNED' });
    expect(byEmail.identities.link).not.toHaveBeenCalled();
  });

  it('keeps the generic 401 for any other inactive account', async () => {
    const { service } = build({ linkedUserId: 'user-1', byId: { ...account, status: UserStatus.INACTIVE } });
    await expect(service.signIn('GOOGLE', 'token', undefined, device)).rejects.toThrow(new UnauthorizedException('Credenciales inválidas.'));
  });

  it('says a pending-review suspension lasts while the report is reviewed, not until 9999', async () => {
    const { service } = build({ byEmail: { ...account, suspendedUntil: PENDING_REVIEW_SUSPENSION_UNTIL } });
    await expect(service.signIn('GOOGLE', 'token', undefined, device))
      .rejects.toThrow('Tu cuenta está suspendida mientras revisamos un reporte.');
  });

  it('asks a new person to complete the profile with a single-purpose signup token', async () => {
    const { service, signupTokens } = build();
    const result = await service.signIn('GOOGLE', 'token', undefined, device);
    expect(result.status).toBe('PROFILE_COMPLETION_REQUIRED');
    const signupToken = (result as { signupToken: string }).signupToken;
    expect(signupTokens.verify(signupToken)).toEqual({ provider: 'GOOGLE', subject: 'sub-1', email: 'ana@gmail.com' });
  });

  it('creates the verified account, its acceptances, identity and device on completion', async () => {
    const { service, users, legal, identities, devices, signupTokens, signupProtection } = build();
    const signupToken = signupTokens.issue({ provider: 'GOOGLE', subject: 'sub-1', email: 'ana@gmail.com' });
    const result = await service.completeSignup('GOOGLE', completion(signupToken), meta);

    // Every account leaves a signup audit row, also the ones a provider vouched for.
    expect(signupProtection.vouchedVerdict).toHaveBeenCalledWith('IDENTITY_GOOGLE', meta.legal.channel);
    expect(signupProtection.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ riskReasons: ['IDENTITY_GOOGLE'] }),
      'user-new',
      transaction,
    );

    expect(users.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@gmail.com', emailVerifiedAt: expect.any(Date) }),
      transaction,
    );
    expect(legal.recordSignupAcceptances).toHaveBeenCalledWith('user-new', meta.legal, transaction);
    expect(identities.link).toHaveBeenCalledWith('GOOGLE', 'sub-1', 'user-new', 'ana@gmail.com', transaction);
    expect(devices.recordSignup).toHaveBeenCalledWith('user-new', device, transaction);
    expect(result).toMatchObject({ status: 'AUTHENTICATED', user: { emailVerified: true } });
  });

  it('inherits the sanction of a closed account with that email and opens no session while suspended', async () => {
    const { service, signupTokens, sanctions, refreshTokens } = build({ inherited: new Date(Date.now() + 86_400_000) });
    const signupToken = signupTokens.issue({ provider: 'GOOGLE', subject: 'sub-1', email: 'ana@gmail.com' });
    await expect(service.completeSignup('GOOGLE', completion(signupToken), meta)).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED', status: 403 });
    expect(sanctions.inheritAtSignup).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-new' }), transaction);
    expect(refreshTokens.create).not.toHaveBeenCalled();
  });

  it('rejects a tampered or foreign signup token and an email taken meanwhile', async () => {
    const { service, signupTokens } = build({ byEmail: account });
    await expect(service.completeSignup('GOOGLE', completion('x'.repeat(40)), meta)).rejects.toMatchObject({
      code: 'SIGNUP_TOKEN_INVALID',
    });
    const appleToken = signupTokens.issue({ provider: 'APPLE', subject: 's', email: 'ana@gmail.com' });
    await expect(service.completeSignup('GOOGLE', completion(appleToken), meta)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const googleToken = signupTokens.issue({ provider: 'GOOGLE', subject: 's', email: 'ana@gmail.com' });
    await expect(service.completeSignup('GOOGLE', completion(googleToken), meta)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('never lets a signup token pass as an access token (distinct audience)', () => {
    const jwt = new JwtService();
    const signupToken = new IdentitySignupTokenService(jwt).issue({ provider: 'GOOGLE', subject: 's', email: 'e@x.test' });
    expect(() => {
      jwt.verify<Record<string, unknown>>(signupToken, {
        secret: env.JWT_ACCESS_SECRET,
        audience: env.JWT_AUDIENCE,
        issuer: env.JWT_ISSUER,
      });
    }).toThrow();
  });
});
