import { Injectable, Logger } from "@nestjs/common";
import { PrivacyRetentionService } from "../modules/privacy/privacy-retention.service";
import { sleep } from "./worker-loop";

/** Once a day is what the retention policy needs (ADR-0014). */
export const PRIVACY_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Spreads runs so several replicas or restarts do not all fire at the same instant. */
export const PRIVACY_RETENTION_JITTER_MS = 30 * 60 * 1000;

/** Wait before the next run: the interval plus a random share of the jitter. */
export function nextPrivacyRetentionDelayMs(random: () => number = Math.random): number {
  return PRIVACY_RETENTION_INTERVAL_MS + Math.floor(random() * PRIVACY_RETENTION_JITTER_MS);
}

/**
 * Long-running form of `yarn db:privacy:retention`: the same purge (spent
 * signup tickets, IP hashes, closed-account sanctions, reported content kept
 * at closure, verification selfies) every 24 h with jitter. The first run waits only the jitter, so
 * a deploy does not postpone it by a day. Every pass is idempotent; a failed
 * one is logged and retried on the next tick instead of killing the worker.
 */
@Injectable()
export class PrivacyRetentionRunner {
  private readonly logger = new Logger(PrivacyRetentionRunner.name);

  constructor(private readonly retention: PrivacyRetentionService) {}

  async run(signal: AbortSignal, random: () => number = Math.random): Promise<void> {
    this.logger.log({ event: "worker.started", worker: "privacy-retention" });
    await sleep(Math.floor(random() * PRIVACY_RETENTION_JITTER_MS), signal);

    while (!signal.aborted) {
      try {
        const result = await this.retention.purge(new Date());
        this.logger.log({ event: "privacy_retention.completed", ...result });
      } catch (error: unknown) {
        this.logger.error({
          event: "privacy_retention.failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
      }
      await sleep(nextPrivacyRetentionDelayMs(random), signal);
    }

    this.logger.log({ event: "worker.stopped", worker: "privacy-retention" });
  }
}
