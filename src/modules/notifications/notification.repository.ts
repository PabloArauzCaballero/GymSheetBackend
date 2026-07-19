import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  NotificationChannel,
  NotificationStatus,
} from '../../common/enums/domain.enums';
import { DeliveryAttemptModel } from './delivery-attempt.model';
import { NotificationPreferenceModel } from './notification-preference.model';
import { NotificationModel } from './notification.model';
import {
  NotificationListInput,
  UpdateNotificationPreferenceInput,
} from './notifications.schemas';

export type ExpiringMembershipCandidate = {
  membershipId: string;
  userId: string;
  planName: string;
  endsOn: string;
  daysRemaining: number;
  channel: NotificationChannel.IN_APP | NotificationChannel.HTTP_GATEWAY;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectModel(NotificationModel)
    private readonly messages: typeof NotificationModel,
    @InjectModel(NotificationPreferenceModel)
    private readonly preferences: typeof NotificationPreferenceModel,
    @InjectModel(DeliveryAttemptModel)
    private readonly attempts: typeof DeliveryAttemptModel,
    private readonly sequelize: Sequelize,
  ) {}

  listForUser(userId: string, filters: NotificationListInput) {
    return this.messages.findAndCountAll({
      where: {
        recipientUserId: userId,
        ...(filters.estado ? { status: filters.estado } : {}),
      },
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
      order: [['createdAt', 'DESC']],
    });
  }

  findForUser(id: string, userId: string) {
    return this.messages.findOne({
      where: { id, recipientUserId: userId },
    });
  }

  async markRead(message: NotificationModel) {
    await message.update({
      status: NotificationStatus.READ,
      readAt: message.readAt ?? new Date(),
    });
    return message;
  }

  findPreference(userId: string) {
    return this.preferences.findOne({ where: { userId } });
  }

  async upsertPreference(
    userId: string,
    input: UpdateNotificationPreferenceInput,
  ) {
    const existing = await this.findPreference(userId);
    if (existing) {
      await existing.update(input);
      return existing;
    }
    return this.preferences.create({ userId, ...input });
  }

  findExpiringMemberships(today: string, limit: number) {
    return this.sequelize.query<ExpiringMembershipCandidate>(
      `SELECT m.id AS "membershipId",
              m.user_id AS "userId",
              p.name AS "planName",
              m.ends_on::text AS "endsOn",
              (m.ends_on - CAST(:today AS date))::integer AS "daysRemaining",
              CASE
                WHEN pref.preferred_channel = 'HTTP_GATEWAY'
                 AND pref.external_delivery_consent_at IS NOT NULL
                 AND pref.consent_version IS NOT NULL
                THEN 'HTTP_GATEWAY'
                ELSE 'IN_APP'
              END AS channel,
              pref.quiet_hours_start::text AS "quietHoursStart",
              pref.quiet_hours_end::text AS "quietHoursEnd"
       FROM membership.memberships m
       JOIN membership.plans p ON p.id = m.plan_id
       LEFT JOIN notifications.preferences pref ON pref.user_id = m.user_id
       WHERE m.status = 'ACTIVE'
         AND p.status = 'ACTIVE'
         AND m.starts_on <= CAST(:today AS date)
         AND m.ends_on >= CAST(:today AS date)
         AND COALESCE(pref.membership_expiry_enabled, true) = true
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(p.reminder_days) AS reminder(day)
           WHERE reminder.day::integer =
             (m.ends_on - CAST(:today AS date))
         )
       ORDER BY m.ends_on ASC, m.id ASC
       LIMIT :limit`,
      {
        replacements: { today, limit },
        type: QueryTypes.SELECT,
      },
    );
  }

  createMessage(input: Record<string, unknown>, transaction: Transaction) {
    return this.messages.create(input, { transaction });
  }

  findMessage(id: string, transaction?: Transaction) {
    return this.messages.findByPk(id, {
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createDeliveryAttempt(
    input: Record<string, unknown>,
    transaction: Transaction,
  ) {
    return this.attempts.create(input, { transaction });
  }

  async updateDeliveryState(
    message: NotificationModel,
    changes: Record<string, unknown>,
    transaction: Transaction,
  ) {
    await message.update(changes, { transaction });
  }
}
