import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { hostname } from "node:os";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { env } from "../../../config/env";
import { OutboxJobModel } from "../../integration/outbox-job.model";
import { OutboxService } from "../../integration/outbox.service";
import { IMAGE_MODERATION_PORT, ImageModerationPort } from "./image-moderation.port";

export const IMAGE_MODERATION_QUEUE = "business.image-moderation";
const IMAGE_MODERATION_EVENT = "business.logo-moderation-requested.v1";
const MAX_ATTEMPTS = 6;
const DRAIN_INTERVAL_MS = 60_000;

const payloadSchema = z.object({ schemaVersion: z.literal(1), submissionId: z.string().uuid(), imageUrl: z.string().url() }).strict();

/**
 * Asynchronous moderation of the logo of a submitted business (plan §2.6):
 * slow or external, so it never blocks the submit. The job is written in the
 * submit transaction; its verdict is appended as an `IMAGE_MODERATION` check.
 * FLAGGED on an automatic approval moves its post-review deadline to now, so
 * REPP sees it first; UNAVAILABLE leaves the image to the post-review.
 * Drained from the API process like `media.release`; tests call `drainOnce`.
 */
@Injectable()
export class ImageModerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageModerationService.name);
  private readonly workerId = `${hostname()}:${process.pid}:image-moderation`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sequelize: Sequelize,
    private readonly outbox: OutboxService,
    @Inject(IMAGE_MODERATION_PORT) private readonly provider: ImageModerationPort,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.drainOnce(), DRAIN_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async requestLogoModeration(submissionId: string, imageUrl: string, transaction: Transaction): Promise<void> {
    await this.outbox.enqueue(
      {
        queueName: IMAGE_MODERATION_QUEUE,
        eventType: IMAGE_MODERATION_EVENT,
        aggregateType: "business.kyc_submissions",
        aggregateId: submissionId,
        deduplicationKey: `image-moderation:${submissionId}`,
        payload: { schemaVersion: 1, submissionId, imageUrl },
        maxAttempts: MAX_ATTEMPTS,
      },
      transaction,
    );
  }

  /** One pass over due jobs. Never throws; returns how many jobs completed. */
  async drainOnce(limit: number = env.WORKER_BATCH_SIZE): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let completed = 0;
    try {
      const jobs = await this.outbox.claim(IMAGE_MODERATION_QUEUE, this.workerId, limit, env.WORKER_LOCK_TIMEOUT_MS);
      for (const job of jobs) if (await this.process(job)) completed += 1;
    } catch (error: unknown) {
      this.logger.warn({ event: "image_moderation.poll_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
    } finally {
      this.running = false;
    }
    return completed;
  }

  private async process(job: OutboxJobModel): Promise<boolean> {
    try {
      const { submissionId, imageUrl } = payloadSchema.parse(job.payload);
      const verdict = await this.provider.moderate({ url: imageUrl });
      const outcome = verdict.outcome === "OK" ? "PASS" : verdict.outcome === "FLAGGED" ? "FAIL" : "WARN";
      const detail = verdict.outcome === "FLAGGED" ? { labels: verdict.labels } : { provider: this.provider.name, verdict: verdict.outcome };
      await this.sequelize.transaction(async (transaction) => {
        await this.sequelize.query(
          `INSERT INTO business.kyc_checks (submission_id, code, outcome, detail) VALUES (:submissionId, 'IMAGE_MODERATION', :outcome, CAST(:detail AS jsonb))`,
          { replacements: { submissionId, outcome, detail: JSON.stringify(detail) }, transaction },
        );
        if (verdict.outcome === "FLAGGED") {
          await this.sequelize.query(
            `UPDATE business.kyc_submissions SET post_review_due_at = now(), updated_at = now()
              WHERE id = :submissionId AND status = 'AUTO_APPROVED'`,
            { replacements: { submissionId }, type: QueryTypes.UPDATE, transaction },
          );
        }
      });
      await this.outbox.complete(job, this.workerId);
      this.logger.log({ event: "image_moderation.completed", outcome });
      return true;
    } catch (error: unknown) {
      const failure = await this.outbox.fail(job, this.workerId, error);
      this.logger.error({ event: "image_moderation.failed", deadLetter: failure.deadLetter, errorName: error instanceof Error ? error.name : "UnknownError" });
      return false;
    }
  }
}
