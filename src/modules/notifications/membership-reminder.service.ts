import { Injectable, Logger } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { NotificationStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { OutboxService } from '../integration/outbox.service';
import { NotificationRepository } from './notification.repository';

export type ReminderScanResult = {
  candidates: number;
  created: number;
  duplicates: number;
};

@Injectable()
export class MembershipReminderService {
  private readonly logger = new Logger(MembershipReminderService.name);

  constructor(
    private readonly repository: NotificationRepository,
    private readonly outbox: OutboxService,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async scan(limit = 500): Promise<ReminderScanResult> {
    const today = this.dates.today();
    const candidates = await this.repository.findExpiringMemberships(today, limit);
    let created = 0;
    let duplicates = 0;

    for (const candidate of candidates) {
      const key = `membership-expiry:${candidate.membershipId}:${candidate.endsOn}:${candidate.daysRemaining}:${candidate.channel}`;
      try {
        await this.sequelize.transaction(async (transaction) => {
          const message = await this.repository.createMessage({
            recipientUserId: candidate.userId,
            membershipId: candidate.membershipId,
            channel: candidate.channel,
            subject: 'Tu plan está por vencer',
            body: this.buildBody(candidate.planName, candidate.daysRemaining, candidate.endsOn),
            daysRemaining: candidate.daysRemaining,
            deduplicationKey: key,
            status: NotificationStatus.PENDING,
            metadata: { reminderDate: today },
          }, transaction);
          await this.outbox.enqueue({
            queueName: 'notifications.delivery',
            eventType: 'membership.expiry.reminder.requested',
            aggregateType: 'notification',
            aggregateId: message.id,
            deduplicationKey: `delivery:${key}`,
            payload: { notificationId: message.id },
          }, transaction);
        });
        created += 1;
      } catch (error: unknown) {
        if (error instanceof UniqueConstraintError) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    this.logger.log({
      event: 'membership_reminders.scanned',
      today,
      candidates: candidates.length,
      created,
      duplicates,
    });
    return { candidates: candidates.length, created, duplicates };
  }

  private buildBody(planName: string, daysRemaining: number, endsOn: string): string {
    if (daysRemaining === 0) {
      return `Tu plan ${planName} vence hoy (${endsOn}). Acércate a recepción para renovarlo.`;
    }
    const unit = daysRemaining === 1 ? 'día' : 'días';
    return `A tu plan ${planName} le quedan ${daysRemaining} ${unit}. Vence el ${endsOn}.`;
  }
}
