import * as bcrypt from 'bcryptjs';
import { UserRole } from '../../common/enums/domain.enums';
import { EmailVerificationService } from '../auth/email-verification.service';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { MediaReleaseService } from '../media/media-release.service';
import { SocialRecommendationOutboxService } from '../social/social-recommendation-outbox.service';
import { UsersRepository } from '../users/users.repository';
import { AccountClosureRepository } from './account-closure.repository';
import { AccountClosureService, closedAccountEmail } from './account-closure.service';

const userId = '00000000-0000-4000-8000-000000000001';
const transaction = { id: 'tx' };
const closedAt = new Date('2026-11-18T10:00:00Z');

type BuildOptions = { role?: UserRole; identity?: boolean; pinKind?: string; keys?: string[]; inUse?: string[]; closedAt?: Date | null };

async function build(options: BuildOptions = {}) {
  const user = {
    id: userId, email: 'ana@example.test', tenantId: null, role: options.role ?? UserRole.CLIENT,
    passwordHash: await bcrypt.hash('secret-pass', 4), closedAt: options.closedAt ?? null,
  };
  const repository = {
    runInTransaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)),
    hasLinkedIdentity: jest.fn().mockResolvedValue(options.identity ?? false),
    countSteps: jest.fn().mockResolvedValue([]),
    collectMediaKeys: jest.fn().mockResolvedValue(options.keys ?? []),
    eraseAll: jest.fn().mockResolvedValue(undefined),
    anonymizeAccount: jest.fn().mockResolvedValue(closedAt),
    keysStillInUse: jest.fn().mockResolvedValue(new Set(options.inUse ?? [])),
  };
  const users = {
    findActiveById: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    lockUserForUpdate: jest.fn().mockResolvedValue(undefined),
  };
  const pins = {
    issuePurposePin: jest.fn().mockResolvedValue(undefined),
    verifyPurposePin: jest.fn().mockResolvedValue(
      options.pinKind && options.pinKind !== 'VERIFIED'
        ? { kind: options.pinKind, attemptsRemaining: 4 }
        : { kind: 'VERIFIED', targetEmail: null },
    ),
  };
  const mediaRelease = { requestRelease: jest.fn().mockResolvedValue(undefined) };
  const sanctions = { recordAtClosure: jest.fn().mockResolvedValue(false) };
  const recommendations = { enqueueProfileSnapshot: jest.fn().mockResolvedValue(undefined) };
  const service = new AccountClosureService(
    repository as unknown as AccountClosureRepository,
    users as unknown as UsersRepository,
    pins as unknown as EmailVerificationService,
    mediaRelease as unknown as MediaReleaseService,
    recommendations as unknown as SocialRecommendationOutboxService,
    sanctions as unknown as ClosedAccountSanctionsService,
  );
  return { service, repository, users, pins, mediaRelease, recommendations, sanctions };
}

describe('AccountClosureService.close', () => {
  it('refuses a wrong password before opening the transaction', async () => {
    const { service, repository } = await build();
    await expect(service.close(userId, { password: 'nope' })).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    expect(repository.runInTransaction).not.toHaveBeenCalled();
  });

  it('refuses staff accounts with 403', async () => {
    const { service, repository } = await build({ role: UserRole.COACH });
    await expect(service.close(userId, { password: 'secret-pass' })).rejects.toMatchObject({ code: 'ACCOUNT_CLOSURE_STAFF', status: 403 });
    expect(repository.eraseAll).not.toHaveBeenCalled();
  });

  it('accepts a PIN only for accounts created with a provider', async () => {
    const { service, pins } = await build({ identity: false });
    await expect(service.close(userId, { pin: '123456' })).rejects.toMatchObject({ code: 'CLOSURE_PROOF_REQUIRED' });
    expect(pins.verifyPurposePin).not.toHaveBeenCalled();
  });

  it('commits a wrong PIN attempt and erases nothing', async () => {
    const { service, repository, pins } = await build({ identity: true, pinKind: 'INVALID' });
    await expect(service.close(userId, { pin: '123456' })).rejects.toMatchObject({ code: 'EMAIL_PIN_INVALID' });
    expect(pins.verifyPurposePin).toHaveBeenCalledWith(userId, 'CLOSE_ACCOUNT', '123456', transaction);
    expect(repository.eraseAll).not.toHaveBeenCalled();
  });

  it('erases, anonymizes and enqueues the file erasure in the same transaction', async () => {
    const keys = Array.from({ length: 205 }, (_, index) => `users/${userId}/perfiles/${index}.jpg`);
    const { service, repository, mediaRelease, recommendations, sanctions } = await build({ keys, inUse: [keys[0]] });
    await expect(service.close(userId, { password: 'secret-pass' })).resolves.toEqual({ closed: true, closedAt });

    expect(repository.collectMediaKeys.mock.invocationCallOrder[0]).toBeLessThan(repository.eraseAll.mock.invocationCallOrder[0]);
    expect(repository.eraseAll).toHaveBeenCalledWith(userId, transaction);
    const [, values] = repository.anonymizeAccount.mock.calls[0] as [string, { tombstoneEmail: string; unusablePasswordHash: string }];
    expect(values.tombstoneEmail).toBe(closedAccountEmail(userId));
    await expect(bcrypt.compare('secret-pass', values.unusablePasswordHash)).resolves.toBe(false);
    expect(recommendations.enqueueProfileSnapshot).toHaveBeenCalledWith(userId, transaction);

    // One job per file on the single media.release queue, written in the closure transaction.
    const jobs = mediaRelease.requestRelease.mock.calls.map(([job]) => job as { aggregateType: string; aggregateId: string; storageKey: string });
    expect(new Set(jobs.map((job) => `${job.aggregateType}:${job.aggregateId}`))).toEqual(new Set([`account:${userId}`]));
    const enqueued = jobs.map((job) => job.storageKey);
    expect(enqueued).toHaveLength(204);
    expect(enqueued).not.toContain(keys[0]);
    expect(mediaRelease.requestRelease.mock.calls[0][1]).toBe(transaction);

    // The sanction snapshot is taken in the same transaction, before the row is anonymized.
    expect(sanctions.recordAtClosure).toHaveBeenCalledWith(expect.objectContaining({ id: userId, email: 'ana@example.test' }), transaction);
    expect(sanctions.recordAtClosure.mock.invocationCallOrder[0]).toBeLessThan(repository.anonymizeAccount.mock.invocationCallOrder[0]);
  });
});

describe('AccountClosureService.requestPin', () => {
  it('sends a CLOSE_ACCOUNT PIN to provider accounts and refuses password accounts', async () => {
    const provider = await build({ identity: true });
    await provider.service.requestPin(userId);
    expect(provider.pins.issuePurposePin.mock.calls[0][1]).toBe('CLOSE_ACCOUNT');
    const password = await build({ identity: false });
    await expect(password.service.requestPin(userId)).rejects.toMatchObject({ code: 'CLOSURE_PROOF_REQUIRED' });
  });
});

describe('AccountClosureService.closeByModeration', () => {
  it('erases a member without any proof and records no carried sanction (a minor may return as an adult)', async () => {
    const { service, repository, users, pins, sanctions } = await build();
    await expect(service.closeByModeration(userId)).resolves.toBe('CLOSED');
    expect(users.lockUserForUpdate).toHaveBeenCalledWith(userId, transaction);
    expect(repository.eraseAll).toHaveBeenCalledWith(userId, transaction);
    expect(repository.anonymizeAccount).toHaveBeenCalledWith(userId, expect.objectContaining({ tombstoneEmail: closedAccountEmail(userId) }), transaction);
    expect(pins.verifyPurposePin).not.toHaveBeenCalled();
    expect(sanctions.recordAtClosure).not.toHaveBeenCalled();
  });

  it('is a no-op for an account already closed or gone, and never closes staff', async () => {
    const closed = await build({ closedAt });
    await expect(closed.service.closeByModeration(userId)).resolves.toBe('ALREADY_CLOSED');
    expect(closed.repository.eraseAll).not.toHaveBeenCalled();
    const gone = await build();
    gone.users.findById.mockResolvedValue(null);
    await expect(gone.service.closeByModeration(userId)).resolves.toBe('ALREADY_CLOSED');
    const staff = await build({ role: UserRole.COACH });
    await expect(staff.service.closeByModeration(userId)).resolves.toBe('STAFF_SKIPPED');
    expect(staff.repository.eraseAll).not.toHaveBeenCalled();
  });
});
