import { Injectable, Logger } from "@nestjs/common";
import { hostname } from "node:os";
import { env } from "../config/env";
import { OutboxJobModel } from "../modules/integration/outbox-job.model";
import { OutboxService } from "../modules/integration/outbox.service";
import { RecommendationsClient, SocialRecommendationEvent } from "../modules/social/recommendations-client";
import { runBounded, sleep } from "./worker-loop";

@Injectable()
export class RecommendationsProjectionRunner {
  private readonly logger = new Logger(RecommendationsProjectionRunner.name);
  private readonly workerId = `${hostname()}:${process.pid}:recommendations-projection`;

  constructor(private readonly outbox: OutboxService, private readonly recommendations: RecommendationsClient) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: "recommendations_projection.started", workerId: this.workerId });
    while (!signal.aborted) {
      if (!env.RECOMMENDATIONS_URL || !env.RECOMMENDATIONS_SERVICE_TOKEN) {
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
        continue;
      }
      try {
        const jobs = await this.outbox.claim("recommendations.projection", this.workerId, env.WORKER_BATCH_SIZE, env.WORKER_LOCK_TIMEOUT_MS);
        if (jobs.length === 0) {
          await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
          continue;
        }
        await runBounded(jobs, env.WORKER_CONCURRENCY, (job) => this.process(job));
      } catch (error) {
        this.logger.error({ event: "recommendations_projection.poll_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      }
    }
    this.logger.log({ event: "recommendations_projection.stopped", workerId: this.workerId });
  }

  private async process(job: OutboxJobModel): Promise<void> {
    try {
      const aggregateVersion = Number(job.payload.aggregateVersion);
      const schemaVersion = job.payload.schemaVersion;
      const type = job.eventType.replace(/\.v1$/u, "");
      if (!job.aggregateId || !job.domainEventId || !Number.isInteger(aggregateVersion) || aggregateVersion < 1 ||
          schemaVersion !== 1 || !["social.profile.updated", "social.profile.deleted"].includes(type)) {
        throw new TypeError("invalid recommendation projection job envelope");
      }
      const event: SocialRecommendationEvent = {
        eventId: job.domainEventId,
        aggregateId: job.aggregateId,
        aggregateVersion,
        schemaVersion: 1,
        type: type as SocialRecommendationEvent["type"],
        payload: job.payload.profile && typeof job.payload.profile === "object"
          ? job.payload.profile as Record<string, unknown>
          : {},
      };
      if (!await this.recommendations.consumeEvents([event])) throw new Error("recommendation service rejected the event batch");
      await this.outbox.complete(job, this.workerId);
    } catch (error) {
      const failure = await this.outbox.fail(job, this.workerId, error);
      this.logger.error({
        event: "recommendations_projection.delivery_failed",
        deadLetter: failure.deadLetter,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
