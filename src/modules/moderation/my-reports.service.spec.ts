import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { MyReportsService } from './my-reports.service';
import { encodeMyReportsCursor, myReportsQuerySchema } from './moderation.schemas';

describe('MyReportsService', () => {
  const reporter: AuthenticatedUser = {
    id: 'reporter-1',
    email: 'socia@gym.test',
    role: UserRole.CLIENT,
    tenantId: 'topfitness',
    tenantScope: 'topfitness',
    impersonating: false,
  };
  const withdrawnAt = new Date('2026-11-16T12:00:00.000Z');

  function build(report: Record<string, unknown> | null, remainingReporters = 0) {
    const repository = {
      listLive: jest.fn().mockResolvedValue([]),
      findOwnForUpdate: jest.fn().mockResolvedValue(report),
      markWithdrawn: jest.fn().mockResolvedValue(withdrawnAt),
      revealAutoHidden: jest.fn().mockResolvedValue(true),
    };
    const moderation = { countDistinctReporters: jest.fn().mockResolvedValue(remainingReporters) };
    const sequelize = {
      transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback({ LOCK: { UPDATE: 'UPDATE' } })),
    };
    const service = new MyReportsService(sequelize as never, repository as never, moderation as never);
    return { service, repository, moderation };
  }

  const openRoutineReport = {
    id: 'report-1',
    targetKind: 'ROUTINE',
    targetId: 'routine-1',
    status: 'PENDIENTE',
    withdrawnAt: null,
  };

  it('looks the report up by id AND reporter, so someone else\'s report is a 404', async () => {
    const { service, repository } = build(null);
    await expect(service.withdraw(reporter, 'report-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findOwnForUpdate).toHaveBeenCalledWith('report-x', 'reporter-1', expect.anything());
    expect(repository.markWithdrawn).not.toHaveBeenCalled();
  });

  it('an open report becomes RETIRADO and, below the threshold, lifts an automatic curtain', async () => {
    const { service, repository, moderation } = build(openRoutineReport, 2);
    const result = await service.withdraw(reporter, 'report-1');
    expect(repository.markWithdrawn).toHaveBeenCalledWith('report-1', 'RETIRADO', expect.anything());
    expect(moderation.countDistinctReporters).toHaveBeenCalledWith('ROUTINE', 'routine-1', expect.anything());
    expect(repository.revealAutoHidden).toHaveBeenCalledWith('ROUTINE', 'routine-1', expect.anything());
    expect(result).toEqual({ id: 'report-1', withdrawn: true, withdrawnAt: withdrawnAt.toISOString(), contentRestored: true });
  });

  it('keeps the curtain while enough other people still report it', async () => {
    const { service, repository } = build(openRoutineReport, 3);
    const result = await service.withdraw(reporter, 'report-1');
    expect(repository.revealAutoHidden).not.toHaveBeenCalled();
    expect(result.contentRestored).toBe(false);
  });

  it('a report a moderator already closed keeps its verdict: status unchanged, nothing revealed', async () => {
    const { service, repository, moderation } = build({ ...openRoutineReport, status: 'RESUELTO' });
    await service.withdraw(reporter, 'report-1');
    expect(repository.markWithdrawn).toHaveBeenCalledWith('report-1', 'RESUELTO', expect.anything());
    expect(moderation.countDistinctReporters).not.toHaveBeenCalled();
    expect(repository.revealAutoHidden).not.toHaveBeenCalled();
  });

  it('a person or a chat message cannot be «revealed»: no curtain lookup', async () => {
    const { service, moderation } = build({ ...openRoutineReport, targetKind: 'USER' });
    await service.withdraw(reporter, 'report-1');
    expect(moderation.countDistinctReporters).not.toHaveBeenCalled();
  });

  it('is idempotent: a second withdrawal answers the first one and writes nothing', async () => {
    const earlier = new Date('2026-11-15T08:00:00.000Z');
    const { service, repository } = build({ ...openRoutineReport, status: 'RETIRADO', withdrawnAt: earlier });
    const result = await service.withdraw(reporter, 'report-1');
    expect(repository.markWithdrawn).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'report-1', withdrawn: true, withdrawnAt: earlier.toISOString(), contentRestored: false });
  });

  it('lists one page more than asked to know whether there is a next cursor, and maps the reporter status', async () => {
    const { service, repository } = build(null);
    const row = (id: string, status: string) => ({
      id, targetKind: 'ROUTINE', targetId: 't', reason: 'SPAM', status,
      createdAt: '2026-11-16T10:00:00.123456Z', title: 'Pierna', ownerName: 'Ana', details: 'never echoed',
    });
    const b = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    repository.listLive.mockResolvedValue([row('a', 'EN_REVISION'), row(b, 'DESCARTADO'), row('c', 'PENDIENTE')]);
    const page = await service.list(reporter, { limit: 2, cursor: null });
    expect(repository.listLive).toHaveBeenCalledWith('reporter-1', 3, null);
    expect(page.items.map((item) => [item.id, item.status])).toEqual([['a', 'EN_REVISION'], [b, 'REVISADA']]);
    expect(page.items[0]).not.toHaveProperty('details');
    expect(myReportsQuerySchema.parse({ cursor: page.nextCursor }).cursor).toEqual({ createdAt: '2026-11-16T10:00:00.123456Z', id: b });
  });
});

describe('myReportsQuerySchema', () => {
  it('defaults to 20, caps at 50 and rejects a forged cursor', () => {
    expect(myReportsQuerySchema.parse({})).toEqual({ limit: 20, cursor: null });
    expect(myReportsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(myReportsQuerySchema.safeParse({ cursor: 'bm90LWpzb24' }).success).toBe(false);
    const sqlish = Buffer.from(JSON.stringify({ c: "2026-01-01'; DROP", i: 'x' })).toString('base64url');
    expect(myReportsQuerySchema.safeParse({ cursor: sqlish }).success).toBe(false);
    const ok = encodeMyReportsCursor({ createdAt: '2026-11-16T10:00:00.123456Z', id: '5a8f2a52-4f43-4d46-9d0f-1b2c3d4e5f60' });
    expect(myReportsQuerySchema.parse({ cursor: ok }).cursor?.id).toBe('5a8f2a52-4f43-4d46-9d0f-1b2c3d4e5f60');
  });
});
