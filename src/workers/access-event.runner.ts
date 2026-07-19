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
      const events = await this.repository.claimEvents(
        this.workerId,
        env.WORKER_BATCH_SIZE,
        env.WORKER_LOCK_TIMEOUT_MS,
      );

      if (events.length === 0) {
        await sleep(env.WORKER_POLL_INTERVAL_MS, signal);
        continue;
      }

      await runBounded(
        events,
        env.WORKER_CONCURRENCY,
        (event) => this.process(event),
      );
    }

    this.logger.log({
      event: 'worker.stopped',
      workerId: this.workerId,
    });
  }

  private async process(event: AccessDeviceEventModel): Promise<void> {
    try {
      await this.service.processEvent(event.id);
    } catch (error: unknown) {
      const deadLetter = await this.repository.markEventFailed(
        event,
        error,
        env.WORKER_MAX_ATTEMPTS,
      );

      this.logger.error({
        event: 'access_event.failed',
        eventId: event.id,
        attempt: event.attemptCount,
        deadLetter,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
