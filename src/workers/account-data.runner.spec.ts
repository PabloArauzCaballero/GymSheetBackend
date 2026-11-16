import { AccountClosureService } from '../modules/account/account-closure.service';
import { ACCOUNT_EXPORT_QUEUE, AccountExportService } from '../modules/export/account-export.service';
import { OutboxJobModel } from '../modules/integration/outbox-job.model';
import { OutboxService } from '../modules/integration/outbox.service';
import { MINOR_ACCOUNT_CLOSURE_QUEUE } from '../modules/moderation/moderation-minor.service';
import { AccountDataRunner } from './account-data.runner';

const exportId = '00000000-0000-4000-8000-0000000000e1';
const userId = '00000000-0000-4000-8000-0000000000a1';

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
  const closures = { closeByModeration: jest.fn().mockResolvedValue('CLOSED') };
  const runner = new AccountDataRunner(
    outbox as unknown as OutboxService,
    exports as unknown as AccountExportService,
    closures as unknown as AccountClosureService,
  );
  return { runner, outbox, exports, closures };
}

const job = (queueName: string, payload: object, id = 'j1') => ({ id, queueName, payload }) as unknown as OutboxJobModel;

describe('AccountDataRunner', () => {
  it('builds exports, completing each job, and claims the export and minor-closure queues (files go to media.release)', async () => {
    const { runner, outbox, exports } = build({ [ACCOUNT_EXPORT_QUEUE]: [job(ACCOUNT_EXPORT_QUEUE, { exportId }), job(ACCOUNT_EXPORT_QUEUE, { exportId }, 'j2')] });
    await expect(runner.drainOnce()).resolves.toBe(2);
    expect(exports.build).toHaveBeenCalledWith(exportId);
    expect(outbox.claim.mock.calls.map(([queue]) => queue)).toEqual([ACCOUNT_EXPORT_QUEUE, MINOR_ACCOUNT_CLOSURE_QUEUE]);
    expect(outbox.complete).toHaveBeenCalledTimes(2);
  });

  it('returns a failed job to the outbox and marks a dead-lettered export as FAILED', async () => {
    const exportJob = job(ACCOUNT_EXPORT_QUEUE, { exportId });
    const retried = build({ [ACCOUNT_EXPORT_QUEUE]: [exportJob] }, { buildFails: true });
    await retried.runner.drainOnce();
    expect(retried.outbox.fail).toHaveBeenCalled();
    expect(retried.exports.markFailed).not.toHaveBeenCalled();
    const dead = build({ [ACCOUNT_EXPORT_QUEUE]: [exportJob] }, { buildFails: true, deadLetter: true });
    await dead.runner.drainOnce();
    expect(dead.exports.markFailed).toHaveBeenCalledWith(exportId, 'TypeError');
  });

  it('closes the account of a confirmed minor and completes the job', async () => {
    const { runner, outbox, closures } = build({ [MINOR_ACCOUNT_CLOSURE_QUEUE]: [job(MINOR_ACCOUNT_CLOSURE_QUEUE, { schemaVersion: 1, userId })] });
    await expect(runner.drainOnce()).resolves.toBe(1);
    expect(closures.closeByModeration).toHaveBeenCalledWith(userId);
    expect(outbox.complete).toHaveBeenCalledTimes(1);
  });

  it('fails (retry, then dead-letter) a minor-closure job whose payload is not the v1 contract', async () => {
    const malformed = [
      job(MINOR_ACCOUNT_CLOSURE_QUEUE, { userId }),
      job(MINOR_ACCOUNT_CLOSURE_QUEUE, { schemaVersion: 1, userId: 'not-a-uuid' }, 'j2'),
      job(MINOR_ACCOUNT_CLOSURE_QUEUE, { schemaVersion: 1, userId, extra: true }, 'j3'),
    ];
    const { runner, outbox, closures, exports } = build({ [MINOR_ACCOUNT_CLOSURE_QUEUE]: malformed }, { deadLetter: true });
    await runner.drainOnce();
    expect(closures.closeByModeration).not.toHaveBeenCalled();
    expect(outbox.fail).toHaveBeenCalledTimes(3);
    expect(outbox.complete).not.toHaveBeenCalled();
    expect(exports.markFailed).not.toHaveBeenCalled();
  });
});
