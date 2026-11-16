import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { hostname } from "node:os";
import { Transaction } from "sequelize";
import { env } from "../../config/env";
import { OutboxJobModel } from "../integration/outbox-job.model";
import { OutboxService } from "../integration/outbox.service";
import { MediaRetentionService } from "./media-retention.service";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "./media-storage.port";

export const MEDIA_RELEASE_QUEUE = "media.release";
const MEDIA_RELEASE_EVENT = "media.file-release-requested.v1";
const MEDIA_RELEASE_MAX_ATTEMPTS = 8;
const DRAIN_INTERVAL_MS = 60_000;

export type MediaReleaseRequest = {
  /** Owner of the reference that was cleared, e.g. "chat.message". */
  aggregateType: string;
  aggregateId: string;
  provider: string;
  storageKey: string;
};

/**
 * Deletes a stored binary whose last reference a transaction just cleared
 * (e.g. a chat message deleted for everyone, ADR-0014).
 *
 * The request is an outbox job written in the SAME transaction that cleared
 * the reference, so it survives a crash and a remote storage outage: a failed
 * removal is retried with the outbox backoff and ends in dead-letter. The
 * removal itself goes through `MediaRetentionService`, which still refuses to
 * delete a binary another row references (content-addressed keys).
 *
 * Drained from the API process on an `unref` timer, like the disappearing
 * chat purge; several instances are safe because claiming uses SKIP LOCKED.
 * Tests call `drainOnce` directly.
 */
@Injectable()
export class MediaReleaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaReleaseService.name);
  private readonly workerId = `${hostname()}:${process.pid}:media-release`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly retention: MediaRetentionService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
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

  async requestRelease(request: MediaReleaseRequest, transaction: Transaction): Promise<void> {
    await this.outbox.enqueue(
      {
        queueName: MEDIA_RELEASE_QUEUE,
        eventType: MEDIA_RELEASE_EVENT,
        aggregateType: request.aggregateType,
        aggregateId: request.aggregateId,
        deduplicationKey: `media-release:${request.aggregateType}:${request.aggregateId}:${request.storageKey}`,
        payload: { schemaVersion: 1, provider: request.provider, storageKey: request.storageKey },
        maxAttempts: MEDIA_RELEASE_MAX_ATTEMPTS,
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
      const jobs = await this.outbox.claim(MEDIA_RELEASE_QUEUE, this.workerId, limit, env.WORKER_LOCK_TIMEOUT_MS);
      for (const job of jobs) {
        if (await this.process(job)) completed += 1;
      }
    } catch (error: unknown) {
      this.logger.warn({ event: "media.release.poll_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
    } finally {
      this.running = false;
    }
    return completed;
  }

  private async process(job: OutboxJobModel): Promise<boolean> {
    try {
      const { provider, storageKey, schemaVersion } = job.payload;
      if (schemaVersion !== 1 || typeof storageKey !== "string" || !storageKey || typeof provider !== "string") {
        throw new TypeError("invalid media release job envelope");
      }
      // A key written by another provider cannot be removed from this one; failing keeps it visible.
      if (provider !== this.storage.name) throw new Error(`media release provider mismatch: ${provider}`);
      const result = await this.retention.deleteRowAndUnreferencedFile(storageKey, () => Promise.resolve());
      await this.outbox.complete(job, this.workerId);
      this.logger.log({ event: "media.release.completed", aggregateType: job.aggregateType, fileRemoved: result.fileRemoved });
      return true;
    } catch (error: unknown) {
      const failure = await this.outbox.fail(job, this.workerId, error);
      this.logger.error({
        event: "media.release.failed",
        deadLetter: failure.deadLetter,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return false;
    }
  }
}
