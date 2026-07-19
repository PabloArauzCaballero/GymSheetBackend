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
      try {
        await this.processAvailableJobs(signal);
      } catch (error: unknown) {
        this.logger.error({
          event: 'notification_delivery.poll_failed',
          workerId: this.workerId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown polling error',
        });
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      }
    }

    this.logger.log({ event: 'worker.stopped', workerId: this.workerId });
  }

  private async processAvailableJobs(signal: AbortSignal): Promise<void> {
    const jobs = await this.outbox.claim(
      'notifications.delivery',
      this.workerId,
      env.WORKER_BATCH_SIZE,
      env.WORKER_LOCK_TIMEOUT_MS,
    );
    if (jobs.length === 0) {
      await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      return;
    }

    await runBounded(
      jobs,
      env.WORKER_CONCURRENCY,
      (job) => this.process(job),
    );
  }

  private async process(job: OutboxJobModel): Promise<void> {
    try {
      await this.delivery.deliver(job);
      const completed = await this.outbox.complete(job, this.workerId);
      if (!completed) {
        this.logger.warn({
          event: 'notification_delivery.lease_lost_after_delivery',
          jobId: job.id,
          attempt: job.attemptCount,
        });
      }
    } catch (error: unknown) {
      try {
        const failure = await this.outbox.fail(job, this.workerId, error);
        if (failure.updated) {
          await this.delivery.recordFailure(
            job,
            error,
            failure.deadLetter,
          );
        }
        this.logger.error({
          event: 'notification_delivery.failed',
          jobId: job.id,
          attempt: job.attemptCount,
          deadLetter: failure.deadLetter,
          leaseUpdated: failure.updated,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      } catch (failureUpdateError: unknown) {
        this.logger.error({
          event: 'notification_delivery.failure_update_failed',
          jobId: job.id,
          attempt: job.attemptCount,
          errorName:
            failureUpdateError instanceof Error
              ? failureUpdateError.name
              : 'UnknownError',
        });
      }
    }
  }
}
