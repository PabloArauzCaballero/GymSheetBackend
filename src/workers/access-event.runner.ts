import { Injectable, Logger } from '@nestjs/common';
import { hostname } from 'node:os';
import { env } from '../config/env';
import { AccessControlRepository } from '../modules/access-control/access-control.repository';
import { AccessControlService } from '../modules/access-control/access-control.service';
import { AccessDeviceEventModel } from '../modules/access-control/access-device-event.model';
import { runBounded, sleep } from './worker-loop';

@Injectable()
export class AccessEventRunner {
  private readonly logger = new Logger(AccessEventRunner.name);
  private readonly workerId = `${hostname()}:${process.pid}:access-events`;

  constructor(
    private readonly repository: AccessControlRepository,
    private readonly service: AccessControlService,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({
      event: 'worker.started',
      workerId: this.workerId,
      queue: 'access_control.device_events',
    });

    while (!signal.aborted) {
      try {
        await this.processAvailableEvents(signal);
      } catch (error: unknown) {
        this.logger.error({
          event: 'access_event.poll_failed',
          workerId: this.workerId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown polling error',
        });
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      }
    }

    this.logger.log({
      event: 'worker.stopped',
      workerId: this.workerId,
    });
  }

  private async processAvailableEvents(signal: AbortSignal): Promise<void> {
    const events = await this.repository.claimEvents(
      this.workerId,
      env.WORKER_BATCH_SIZE,
      env.WORKER_LOCK_TIMEOUT_MS,
    );

    if (events.length === 0) {
      await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
      return;
    }

    await runBounded(
      events,
      env.WORKER_CONCURRENCY,
      (event) => this.process(event),
    );
  }

  private async process(event: AccessDeviceEventModel): Promise<void> {
    try {
      await this.service.processEvent(
        event.id,
        this.workerId,
        event.attemptCount,
      );
    } catch (error: unknown) {
      try {
        const failure = await this.repository.markEventFailed(
          event,
          this.workerId,
          error,
          env.WORKER_MAX_ATTEMPTS,
        );
        this.logger.error({
          event: 'access_event.failed',
          eventId: event.id,
          attempt: event.attemptCount,
          deadLetter: failure.deadLetter,
          leaseUpdated: failure.updated,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      } catch (failureUpdateError: unknown) {
        this.logger.error({
          event: 'access_event.failure_update_failed',
          eventId: event.id,
          attempt: event.attemptCount,
          errorName:
            failureUpdateError instanceof Error
              ? failureUpdateError.name
              : 'UnknownError',
        });
      }
    }
  }
}
