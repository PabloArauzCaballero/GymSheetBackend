import { NotFoundException } from '@nestjs/common';
import { OutboxService } from '../integration/outbox.service';
import { NoticeEmailService } from '../notifications/notice-email.service';
import { NotificationService } from '../notifications/notification.service';
import { KycExportReader } from '../business-kyc/kyc-export.reader';
import { AccountExportRepository } from './account-export.repository';
import { BUSINESS_EXPORT_SECTIONS } from './business-export.sections';
import { ACCOUNT_EXPORT_SECTIONS } from './account-export.sections';
import { ACCOUNT_EXPORT_QUEUE, ACCOUNT_EXPORT_ROWS_PER_TABLE, AccountExportService } from './account-export.service';

const userId = '00000000-0000-4000-8000-000000000001';
const exportId = '00000000-0000-4000-8000-0000000000e1';
const transaction = { id: 'tx' };
const pending = { id: exportId, userId, status: 'PENDING', sizeBytes: null, requestedAt: new Date(), completedAt: null, expiresAt: null };

function build(options: { latest?: Date | null; row?: object | null; archive?: string | null; sectionRows?: number; transitioned?: boolean; businessKyc?: object | null } = {}) {
  const repository = {
    runInTransaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)),
    lockAccount: jest.fn().mockResolvedValue(undefined),
    latestRequestSince: jest.fn().mockResolvedValue(options.latest ?? null),
    create: jest.fn().mockResolvedValue(pending),
    findOwn: jest.fn().mockResolvedValue(options.row === undefined ? pending : options.row),
    findById: jest.fn().mockResolvedValue(options.row === undefined ? pending : options.row),
    findLatestOwn: jest.fn().mockResolvedValue(options.row === undefined ? pending : options.row),
    readArchive: jest.fn().mockResolvedValue(options.archive ?? null),
    readSection: jest.fn().mockResolvedValue(Array.from({ length: options.sectionRows ?? 1 }, (_, index) => ({ index }))),
    markReady: jest.fn().mockResolvedValue(options.transitioned ?? true),
    markFailed: jest.fn().mockResolvedValue(options.transitioned ?? true),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const noticeEmails = { enqueue: jest.fn().mockResolvedValue(true) };
  const kycExport = { read: jest.fn().mockResolvedValue(options.businessKyc ?? null) };
  const service = new AccountExportService(
    repository as unknown as AccountExportRepository,
    outbox as unknown as OutboxService,
    notifications as unknown as NotificationService,
    noticeEmails as unknown as NoticeEmailService,
    kycExport as unknown as KycExportReader,
  );
  return { service, repository, outbox, notifications, noticeEmails };
}

describe('AccountExportService', () => {
  it('records the request and enqueues the job in one transaction', async () => {
    const { service, outbox } = build();
    await expect(service.request(userId)).resolves.toMatchObject({ id: exportId, status: 'PENDING', downloadPath: null });
    const [job, tx] = outbox.enqueue.mock.calls[0] as [{ queueName: string; payload: unknown }, unknown];
    expect(job).toMatchObject({ queueName: ACCOUNT_EXPORT_QUEUE, payload: { exportId } });
    expect(tx).toBe(transaction);
  });

  it('allows one request per 24 hours and says when the next one is possible', async () => {
    const { service, outbox } = build({ latest: new Date(Date.now() - 60 * 60 * 1000) });
    const error = (await service.request(userId).catch((caught: unknown) => caught)) as { status: number; code: string; details: { retryAfterSeconds: number } };
    expect(error).toMatchObject({ status: 429, code: 'ACCOUNT_EXPORT_RATE_LIMITED' });
    expect(error.details.retryAfterSeconds).toBeGreaterThan(22 * 3600);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('answers 404 for an export that is not the caller and 409 while it is not ready', async () => {
    await expect(build({ row: null }).service.status(userId, exportId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ row: null }).service.download(userId, exportId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(build().service.download(userId, exportId)).rejects.toMatchObject({ code: 'ACCOUNT_EXPORT_NOT_READY' });
  });

  it('returns the latest request of the caller so a reload can resume it, or null when there is none', async () => {
    const { service, repository } = build();
    await expect(service.latest(userId)).resolves.toEqual({ export: expect.objectContaining({ id: exportId, status: 'PENDING' }) });
    expect(repository.findLatestOwn).toHaveBeenCalledWith(userId);
    await expect(build({ row: null }).service.latest(userId)).resolves.toEqual({ export: null });
  });

  it('adds the business sections and its KYC only for a business account (ADR-0028)', async () => {
    const businessKyc = { submissions: [], documents: [] };
    const { service, repository } = build({ businessKyc });
    await service.build(exportId);
    expect(repository.readSection).toHaveBeenCalledTimes(ACCOUNT_EXPORT_SECTIONS.length + BUSINESS_EXPORT_SECTIONS.length);
    const parsed = JSON.parse((repository.markReady.mock.calls[0] as [string, string])[1]) as { tables: Record<string, unknown>; businessKyc?: unknown };
    expect(Object.keys(parsed.tables)).toEqual(expect.arrayContaining(['business.profile', 'business.orders', 'business.affiliations', 'directory.payment_orders']));
    expect(parsed.businessKyc).toEqual(businessKyc);
    const person = build();
    await person.service.build(exportId);
    expect(JSON.parse((person.repository.markReady.mock.calls[0] as [string, string])[1])).not.toHaveProperty('businessKyc');
  });

  it('never exports the buyer id, notes or a member\'s CI digits to the business', () => {
    const omitted = (key: string) => BUSINESS_EXPORT_SECTIONS.find((entry) => entry.key === key)?.omit ?? [];
    expect(omitted('business.orders')).toEqual(expect.arrayContaining(['athlete_user_id', 'athlete_notes', 'receipt_private_key']));
    expect(omitted('business.affiliations')).toEqual(expect.arrayContaining(['user_id', 'ci_last3']));
    expect(omitted('business.subscriptions')).toEqual(expect.arrayContaining(['user_id', 'notes']));
    for (const entry of BUSINESS_EXPORT_SECTIONS) expect([entry.key, entry.where.includes(':userId')]).toEqual([entry.key, true]);
  });

  it('builds one section per data-map table and flags a capped table as truncated', async () => {
    const { service, repository } = build({ sectionRows: ACCOUNT_EXPORT_ROWS_PER_TABLE + 1 });
    await service.build(exportId);
    expect(repository.readSection).toHaveBeenCalledTimes(ACCOUNT_EXPORT_SECTIONS.length);
    const [, archive] = repository.markReady.mock.calls[0] as [string, string, Date];
    const parsed = JSON.parse(archive) as { tables: Record<string, { rows: unknown[]; truncated: boolean }> };
    const users = parsed.tables['public.usuarios'];
    expect(users.truncated).toBe(true);
    expect(users.rows).toHaveLength(ACCOUNT_EXPORT_ROWS_PER_TABLE);
  });

  it('tells the owner in the app and by email that the copy is ready, in the transaction that marks it', async () => {
    const { service, repository, notifications, noticeEmails } = build();
    await service.build(exportId);
    const [message, tx] = notifications.enqueueDirectMessage.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(message).toMatchObject({
      recipientUserId: userId,
      channel: 'IN_APP',
      subject: 'Tu copia de datos está lista',
      deduplicationKey: `account-export.ready:${exportId}`,
      metadata: { type: 'ACCOUNT_EXPORT_READY', exportId, downloadPath: `/me/export/${exportId}/download` },
    });
    expect(tx).toBe(transaction);
    expect(repository.markReady.mock.calls[0][3]).toBe(transaction);
    expect(noticeEmails.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: userId, subject: 'Tu copia de datos está lista', deduplicationKey: `account-export.ready:${exportId}` }),
      transaction,
    );
  });

  it('notifies once: a call that did not move the export out of PENDING says nothing', async () => {
    const { service, notifications, noticeEmails } = build({ transitioned: false });
    await service.build(exportId);
    await service.markFailed(exportId, 'Error');
    expect(notifications.enqueueDirectMessage).not.toHaveBeenCalled();
    expect(noticeEmails.enqueue).not.toHaveBeenCalled();
  });

  it('tells the owner when the copy could not be prepared', async () => {
    const { service, repository, notifications, noticeEmails } = build();
    await service.markFailed(exportId, 'TimeoutError');
    expect(repository.markFailed).toHaveBeenCalledWith(exportId, 'TimeoutError', transaction);
    expect(notifications.enqueueDirectMessage.mock.calls[0][0]).toMatchObject({
      recipientUserId: userId,
      deduplicationKey: `account-export.failed:${exportId}`,
      metadata: { type: 'ACCOUNT_EXPORT_FAILED', exportId },
    });
    expect(noticeEmails.enqueue).toHaveBeenCalledTimes(1);
  });

  it('never rebuilds an export that is no longer pending', async () => {
    const { service, repository } = build({ row: { ...pending, status: 'READY' } });
    await service.build(exportId);
    expect(repository.readSection).not.toHaveBeenCalled();
  });

  it('never exports credential material', () => {
    const omitted = (table: string) => ACCOUNT_EXPORT_SECTIONS.find((section) => section.table === table)?.omit ?? [];
    expect(omitted('public.usuarios')).toContain('password_hash');
    expect(omitted('auth.refresh_tokens')).toContain('token_hash');
    expect(omitted('auth.email_verification_pins')).toContain('pin_hash');
    expect(omitted('retired.access_control_credentials')).toContain('pin_hash');
    expect(omitted('notifications.device_tokens')).toContain('push_token');
  });

  it('exports the verification attempts without the selfie key or the moderator', () => {
    const verification = ACCOUNT_EXPORT_SECTIONS.find((section) => section.table === 'social.photo_verifications');
    expect(verification?.where).toBe('t.user_id = :userId');
    expect(verification?.omit).toEqual(expect.arrayContaining(['selfie_storage_key', 'reviewer_id']));
  });
});
