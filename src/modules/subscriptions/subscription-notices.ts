import { Injectable, Logger } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { NotificationService } from '../notifications/notification.service';
import { REASON_TEXT } from './subscription.catalog';

export type SubscriptionNotice = {
  event: 'CANCELLED' | 'SUSPENDED' | 'REACTIVATED';
  reasonCode: keyof typeof REASON_TEXT | null;
  note: string | null;
  sequence: number;
};

function render(planName: string, sellerName: string, notice: SubscriptionNotice): { subject: string; body: string } {
  const why = notice.reasonCode ? ` ${REASON_TEXT[notice.reasonCode]}${notice.note ? ` «${notice.note}».` : ''}` : '';
  switch (notice.event) {
    case 'CANCELLED':
      return { subject: `Suscripción cancelada · ${sellerName}`, body: `${sellerName} canceló tu «${planName}».${why}` };
    case 'SUSPENDED':
      return { subject: `Suscripción en pausa · ${sellerName}`, body: `${sellerName} pausó tu «${planName}».${why}` };
    case 'REACTIVATED':
      return { subject: `Suscripción reactivada · ${sellerName}`, body: `${sellerName} reactivó tu «${planName}».` };
  }
}

/** In-app notices of the business's decisions on a period. A notice that fails never undoes the change. */
@Injectable()
export class SubscriptionNotices {
  private readonly logger = new Logger(SubscriptionNotices.name);

  constructor(private readonly notifications: NotificationService) {}

  async send(
    period: { id: string; userId: string; planName: string },
    sellerName: string,
    notice: SubscriptionNotice,
    transaction: Transaction,
  ): Promise<void> {
    const { subject, body } = render(period.planName, sellerName, notice);
    try {
      // Its own savepoint (inside the service): a failure rolls back the notice only.
      await this.notifications.enqueueDirectMessage(
        {
          recipientUserId: period.userId,
          channel: NotificationChannel.IN_APP,
          subject,
          body,
          deduplicationKey: `subscription:${period.id}:${notice.event.toLowerCase()}:${notice.sequence}`,
          metadata: { kind: 'SUBSCRIPTION', event: notice.event, membershipId: period.id },
        },
        transaction,
      );
    } catch (error: unknown) {
      this.logger.warn({ event: 'subscription.notice_failed', notice: notice.event, errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
}
