import { Injectable, Logger } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { NotificationStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { REMINDER_DAYS } from '../subscriptions/subscription.catalog';
import { ExpiringMembershipCandidate, NotificationRepository } from './notification.repository';
import { NotificationScheduleService } from './notification-schedule.service';

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
    private readonly events: DomainEventPublisher,
    private readonly schedule: NotificationScheduleService,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async scan(limit = 500): Promise<ReminderScanResult> {
    const today = this.dates.today();
    const candidates = await this.repository.findExpiringMemberships(
      today,
      REMINDER_DAYS,
      limit,
    );
    let created = 0;
    let duplicates = 0;

    for (const candidate of candidates) {
      const key = [
        'membership-expiry',
        candidate.membershipId,
        candidate.endsOn,
        candidate.daysRemaining,
        candidate.channel,
      ].join(':');

      try {
        await this.sequelize.transaction(async (transaction) => {
          const message = await this.repository.createMessage(
            {
              recipientUserId: candidate.userId,
              membershipId: candidate.membershipId,
              channel: candidate.channel,
              subject: 'Tu suscripción está por vencer',
              body: this.buildBody(candidate),
              daysRemaining: candidate.daysRemaining,
              deduplicationKey: key,
              status: NotificationStatus.PENDING,
              metadata: { reminderDate: today },
            },
            transaction,
          );
          const availableAt = this.schedule.nextAllowedAt(
            new Date(),
            candidate.quietHoursStart,
            candidate.quietHoursEnd,
          );

          await this.events.recordAndEnqueue(
            {
              eventName: GymDomainEvent.NOTIFICATION_DELIVERY_REQUESTED,
              aggregateType: 'notification',
              aggregateId: message.id,
              deduplicationKey: `notification.delivery-requested:${message.id}`,
              payload: {
                notificationId: message.id,
                recipientUserId: candidate.userId,
                channel: candidate.channel,
              },
              metadata: {
                membershipId: candidate.membershipId,
                daysRemaining: candidate.daysRemaining,
              },
            },
            [
              {
                queueName: 'notifications.delivery',
                deduplicationKey: `delivery:${key}`,
                payload: { notificationId: message.id },
                availableAt,
              },
            ],
            transaction,
          );
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

  private buildBody(candidate: ExpiringMembershipCandidate): string {
    const what = candidate.sellerName
      ? `«${candidate.planName}» de ${candidate.sellerName}`
      : `«${candidate.planName}»`;
    if (candidate.daysRemaining === 0) {
      return `Tu ${what} vence hoy (${candidate.endsOn}). Renuévala desde Mis suscripciones.`;
    }
    const unit = candidate.daysRemaining === 1 ? 'día' : 'días';
    return `A tu ${what} le quedan ${candidate.daysRemaining} ${unit}. Vence el ${candidate.endsOn}; puedes renovarla desde Mis suscripciones.`;
  }
}
