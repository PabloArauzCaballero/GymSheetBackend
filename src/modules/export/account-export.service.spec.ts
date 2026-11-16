import { NotFoundException } from '@nestjs/common';
import { OutboxService } from '../integration/outbox.service';
import { AccountExportRepository } from './account-export.repository';
import { ACCOUNT_EXPORT_SECTIONS } from './account-export.sections';
import { ACCOUNT_EXPORT_QUEUE, ACCOUNT_EXPORT_ROWS_PER_TABLE, AccountExportService } from './account-export.service';

const userId = '00000000-0000-4000-8000-000000000001';
const exportId = '00000000-0000-4000-8000-0000000000e1';
const transaction = { id: 'tx' };
const pending = { id: exportId, userId, status: 'PENDING', sizeBytes: null, requestedAt: new Date(), completedAt: null, expiresAt: null };

function build(options: { latest?: Date | null; row?: object | null; archive?: string | null; sectionRows?: number } = {}) {
  const repository = {
    runInTransaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)),
    lockAccount: jest.fn().mockResolvedValue(undefined),
    latestRequestSince: jest.fn().mockResolvedValue(options.latest ?? null),
    create: jest.fn().mockResolvedValue(pending),
    findOwn: jest.fn().mockResolvedValue(options.row === undefined ? pending : options.row),
    findById: jest.fn().mockResolvedValue(options.row === undefined ? pending : options.row),
    readArchive: jest.fn().mockResolvedValue(options.archive ?? null),
    readSection: jest.fn().mockResolvedValue(Array.from({ length: options.sectionRows ?? 1 }, (_, index) => ({ index }))),
    markReady: jest.fn().mockResolvedValue(undefined),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new AccountExportService(repository as unknown as AccountExportRepository, outbox as unknown as OutboxService);
  return { service, repository, outbox };
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
    expect(omitted('access_control.credentials')).toContain('pin_hash');
    expect(omitted('notifications.device_tokens')).toContain('push_token');
  });

  it('exports the verification attempts without the selfie key or the moderator', () => {
    const verification = ACCOUNT_EXPORT_SECTIONS.find((section) => section.table === 'social.photo_verifications');
    expect(verification?.where).toBe('t.user_id = :userId');
    expect(verification?.omit).toEqual(expect.arrayContaining(['selfie_storage_key', 'reviewer_id']));
  });
});
