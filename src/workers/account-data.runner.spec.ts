import { AccountMediaErasureService } from '../modules/account/account-media-erasure.service';
import { ACCOUNT_MEDIA_ERASURE_QUEUE } from '../modules/account/account-closure.service';
import { ACCOUNT_EXPORT_QUEUE, AccountExportService } from '../modules/export/account-export.service';
import { OutboxJobModel } from '../modules/integration/outbox-job.model';
import { OutboxService } from '../modules/integration/outbox.service';
import { AccountDataRunner } from './account-data.runner';

const exportId = '00000000-0000-4000-8000-0000000000e1';

function build(jobs: Record<string, object[]>, options: { deadLetter?: boolean; buildFails?: boolean } = {}) {
  const outbox = {
    claim: jest.fn((queue: string) => Promise.resolve(jobs[queue] ?? [])),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue({ deadLetter: options.deadLetter ?? false, updated: true }),
  };
  const exports = {
    build: options.buildFails ? jest.fn().mockRejectedValue(new TypeError('boom')) : jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    purgeExpired: jest.fn().mockResolvedValue(0),
  };
  const media = { erase: jest.fn().mockResolvedValue({ removed: 1, kept: 0 }) };
  const runner = new AccountDataRunner(
    outbox as unknown as OutboxService,
    exports as unknown as AccountExportService,
    media as unknown as AccountMediaErasureService,
  );
  return { runner, outbox, exports, media };
}

describe('AccountDataRunner', () => {
  it('builds exports and erases media, completing each job', async () => {
    const exportJob = { id: 'j1', queueName: ACCOUNT_EXPORT_QUEUE, payload: { exportId } } as unknown as OutboxJobModel;
    const mediaJob = { id: 'j2', queueName: ACCOUNT_MEDIA_ERASURE_QUEUE, payload: { storageKeys: ['k'] } } as unknown as OutboxJobModel;
    const { runner, outbox, exports, media } = build({ [ACCOUNT_EXPORT_QUEUE]: [exportJob], [ACCOUNT_MEDIA_ERASURE_QUEUE]: [mediaJob] });
    await expect(runner.drainOnce()).resolves.toBe(2);
    expect(exports.build).toHaveBeenCalledWith(exportId);
    expect(media.erase).toHaveBeenCalledWith({ storageKeys: ['k'] });
    expect(outbox.complete).toHaveBeenCalledTimes(2);
  });

  it('returns a failed job to the outbox and marks a dead-lettered export as FAILED', async () => {
    const exportJob = { id: 'j1', queueName: ACCOUNT_EXPORT_QUEUE, payload: { exportId } } as unknown as OutboxJobModel;
    const retried = build({ [ACCOUNT_EXPORT_QUEUE]: [exportJob] }, { buildFails: true });
    await retried.runner.drainOnce();
    expect(retried.outbox.fail).toHaveBeenCalled();
    expect(retried.exports.markFailed).not.toHaveBeenCalled();
    const dead = build({ [ACCOUNT_EXPORT_QUEUE]: [exportJob] }, { buildFails: true, deadLetter: true });
    await dead.runner.drainOnce();
    expect(dead.exports.markFailed).toHaveBeenCalledWith(exportId, 'TypeError');
  });
});
