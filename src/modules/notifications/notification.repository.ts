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
  sellerName: string | null;
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

  /** Address on file of an account that is not closed (a closed one only has a tombstone). */
  async openAccountEmail(userId: string, transaction?: Transaction): Promise<string | null> {
    const [row] = await this.sequelize.query<{ email: string }>(
      `SELECT email FROM public.usuarios WHERE id = :userId AND closed_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    return row?.email ?? null;
  }

  listForUser(userId: string, filters: NotificationListInput) {
    return this.messages.findAndCountAll({
      where: {
        recipientUserId: userId,
        // Credential-carrying messages never reach the in-app inbox.
        secret: false,
        ...(filters.estado ? { status: filters.estado } : {}),
      },
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
      order: [['createdAt', 'DESC']],
    });
  }

  countUnreadForUser(userId: string) {
    return this.messages.count({
      where: { recipientUserId: userId, readAt: null, secret: false },
    });
  }

  findForUser(id: string, userId: string) {
    return this.messages.findOne({
      where: { id, recipientUserId: userId, secret: false },
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

  async allowsMessagePreview(userId: string): Promise<boolean> {
    const preference = await this.preferences.findOne({
      attributes: ['messagePreviewEnabled'],
      where: { userId },
    });
    return preference?.messagePreviewEnabled === true;
  }

  createDefaultPreference(userId: string, transaction: Transaction) {
    return this.preferences.create(
      {
        userId,
        membershipExpiryEnabled: true,
        messagePreviewEnabled: false,
        preferredChannel: NotificationChannel.IN_APP,
        externalDeliveryConsentAt: null,
        consentVersion: null,
        quietHoursStart: null,
        quietHoursEnd: null,
        metadata: {},
      },
      { transaction },
    );
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

  /**
   * Periods of the subscription ledger (ADR-0026) ending in exactly one of
   * `reminderDays` days. A period already renewed (a later ACTIVE period of
   * the same listing chained after it) is not reminded.
   */
  findExpiringMemberships(today: string, reminderDays: readonly number[], limit: number) {
    return this.sequelize.query<ExpiringMembershipCandidate>(
      `SELECT m.id AS "membershipId",
              m.user_id AS "userId",
              m.plan_name AS "planName",
              e.name AS "sellerName",
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
       LEFT JOIN directory.entities e ON e.id = m.entity_id
       LEFT JOIN notifications.preferences pref ON pref.user_id = m.user_id
       WHERE m.status = 'ACTIVE'
         AND m.starts_on <= CAST(:today AS date)
         AND m.ends_on >= CAST(:today AS date)
         AND (m.ends_on - CAST(:today AS date)) IN (:reminderDays)
         AND COALESCE(pref.membership_expiry_enabled, true) = true
         AND NOT EXISTS (
           SELECT 1 FROM membership.memberships next
            WHERE next.user_id = m.user_id AND next.entity_plan_id = m.entity_plan_id
              AND next.status = 'ACTIVE' AND next.starts_on > m.ends_on
         )
       ORDER BY m.ends_on ASC, m.id ASC
       LIMIT :limit`,
      {
        replacements: { today, reminderDays: [...reminderDays], limit },
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

  async isConnectionNoticeActive(
    connectionId: string,
    recipientUserId: string,
  ): Promise<boolean> {
    const rows = await this.sequelize.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM social.connections c
          WHERE c.id = CAST(:connectionId AS uuid)
            AND c.status = 'ACCEPTED'
            AND CAST(:recipientUserId AS uuid) IN (c.requester_id, c.addressee_id)
            AND NOT EXISTS (
              SELECT 1 FROM social.user_blocks b
               WHERE (b.blocker_id = c.requester_id AND b.blocked_id = c.addressee_id)
                  OR (b.blocker_id = c.addressee_id AND b.blocked_id = c.requester_id)
            )
       ) AS active`,
      {
        replacements: { connectionId, recipientUserId },
        type: QueryTypes.SELECT,
      },
    );
    return rows[0]?.active === true;
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
