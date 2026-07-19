import { Injectable, Logger } from '@nestjs/common';
import { hostname } from 'node:os';
import { env } from '../config/env';
import { OutboxJobModel } from '../modules/integration/outbox-job.model';
import { OutboxService } from '../modules/integration/outbox.service';
import { NotificationDeliveryService } from '../modules/notifications/notification-delivery.service';
import { runBounded, sleep } from './worker-loop';

@Injectable()
export class NotificationDeliveryRunner {
  private readonly logger = new Logger(NotificationDeliveryRunner.name);
  private readonly workerId = `${hostname()}:${process.pid}:notification-delivery`;

  constructor(
    private readonly outbox: OutboxService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: 'worker.started', workerId: this.workerId });
    while (!signal.aborted) {
      const jobs = await this.outbox.claim(
        'notifications.delivery',
        this.workerId,
        env.WORKER_BATCH_SIZE,
        env.WORKER_LOCK_TIMEOUT_MS,
      );
      if (jobs.length === 0) {
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
        continue;
      }
      await runBounded(jobs, env.WORKER_CONCURRENCY, (job) => this.process(job));
    }
    this.logger.log({ event: 'worker.stopped', workerId: this.workerId });
  }

  private async process(job: OutboxJobModel): Promise<void> {
    try {
      await this.delivery.deliver(job);
      await this.outbox.complete(job.id);
    } catch (error: unknown) {
      const deadLetter = await this.outbox.fail(job, error);
      await this.delivery.recordFailure(job, error, deadLetter);
      this.logger.error({
        event: 'notification_delivery.failed',
        jobId: job.id,
        attempt: job.attemptCount,
        deadLetter,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
