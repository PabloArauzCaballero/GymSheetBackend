import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { MembershipReminderService } from '../modules/notifications/membership-reminder.service';
import { sleep } from './worker-loop';

@Injectable()
export class MembershipReminderRunner {
  private readonly logger = new Logger(MembershipReminderRunner.name);

  constructor(private readonly reminders: MembershipReminderService) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: 'worker.started', worker: 'membership-reminder' });
    while (!signal.aborted) {
      try {
        await this.reminders.scan(env.WORKER_BATCH_SIZE * 10);
      } catch (error: unknown) {
        this.logger.error({
          event: 'membership_reminder.scan_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      await sleep(env.REMINDER_SCAN_INTERVAL_MS, signal);
    }
    this.logger.log({ event: 'worker.stopped', worker: 'membership-reminder' });
  }
}
