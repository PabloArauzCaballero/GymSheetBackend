import { Injectable, Logger } from "@nestjs/common";
import { hostname } from "node:os";
import { z } from "zod";
import { env } from "../config/env";
import { AccountMediaErasureService } from "../modules/account/account-media-erasure.service";
import { ACCOUNT_MEDIA_ERASURE_QUEUE } from "../modules/account/account-closure.service";
import { ACCOUNT_EXPORT_QUEUE, AccountExportService } from "../modules/export/account-export.service";
import { OutboxJobModel } from "../modules/integration/outbox-job.model";
import { OutboxService } from "../modules/integration/outbox.service";
import { runBounded, sleep } from "./worker-loop";

const exportPayloadSchema = z.object({ exportId: z.string().uuid() }).strict();

/**
 * Account-rights jobs: building full exports and erasing the files of closed
 * accounts. Failures go back to the outbox (finite retries, backoff,
 * dead-letter); a dead-lettered export is marked FAILED so its owner can see it.
 */
@Injectable()
export class AccountDataRunner {
  private readonly logger = new Logger(AccountDataRunner.name);
  private readonly workerId = `${hostname()}:${process.pid}:account-data`;

  constructor(
    private readonly outbox: OutboxService,
    private readonly exports: AccountExportService,
    private readonly mediaErasure: AccountMediaErasureService,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: "account_data.started", workerId: this.workerId });
    while (!signal.aborted) {
      try {
        const processed = await this.drainOnce();
        await this.exports.purgeExpired();
        if (processed === 0) await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      } catch (error) {
        this.logger.error({
          event: "account_data.poll_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      }
    }
    this.logger.log({ event: "account_data.stopped", workerId: this.workerId });
  }

  /** One claim per queue; returns how many jobs it handled. */
  async drainOnce(): Promise<number> {
    let processed = 0;
    for (const queue of [ACCOUNT_EXPORT_QUEUE, ACCOUNT_MEDIA_ERASURE_QUEUE]) {
      const jobs = await this.outbox.claim(queue, this.workerId, env.WORKER_BATCH_SIZE, env.WORKER_LOCK_TIMEOUT_MS);
      await runBounded(jobs, env.WORKER_CONCURRENCY, (job) => this.process(job));
      processed += jobs.length;
    }
    return processed;
  }

  private async process(job: OutboxJobModel): Promise<void> {
    try {
      if (job.queueName === ACCOUNT_EXPORT_QUEUE) {
        await this.exports.build(exportPayloadSchema.parse(job.payload).exportId);
      } else {
        const result = await this.mediaErasure.erase(job.payload);
        this.logger.log({ event: "account_data.media_erased", jobId: job.id, ...result });
      }
      await this.outbox.complete(job, this.workerId);
    } catch (error) {
      const failure = await this.outbox.fail(job, this.workerId, error);
      const parsed = exportPayloadSchema.safeParse(job.payload);
      if (failure.deadLetter && job.queueName === ACCOUNT_EXPORT_QUEUE && parsed.success) {
        await this.exports.markFailed(parsed.data.exportId, error instanceof Error ? error.name : "UnknownError");
      }
      this.logger.error({
        event: "account_data.job_failed",
        queue: job.queueName,
        deadLetter: failure.deadLetter,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
