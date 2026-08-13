import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { randomUUID } from "crypto";
import { QueryTypes, UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import {
  NotificationChannel,
  NotificationStatus,
  UserRole,
  UserStatus,
} from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";
import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";
import { BroadcastInput, BroadcastSegment } from "./broadcast.schemas";
import { NotificationRepository } from "./notification.repository";

export interface BroadcastResult {
  campaignId: string;
  segment: BroadcastSegment;
  recipients: number;
  created: number;
  duplicates: number;
}

/**
 * Campañas de publicidad in-app. Reutiliza el pipeline transaccional existente:
 * crea un `messages` por destinatario y encola su entrega en el outbox
 * (`notifications.delivery`), que el worker de entrega de notificaciones procesa.
 * No introduce cola ni proveedor nuevos.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly repository: NotificationRepository,
    private readonly events: DomainEventPublisher,
    private readonly sequelize: Sequelize,
    @InjectModel(UserModel)
    private readonly users: typeof UserModel,
  ) {}

  private async resolveRecipients(
    segment: BroadcastSegment,
    limit: number,
  ): Promise<string[]> {
    if (segment === "ACTIVE_MEMBERS") {
      const rows = await this.sequelize.query<{ userId: string }>(
        `SELECT DISTINCT m.user_id AS "userId"
         FROM membership.memberships m
         JOIN public.usuarios u ON u.id = m.user_id
         WHERE m.status = 'ACTIVE' AND u.estado = :active
         LIMIT :limit`,
        {
          type: QueryTypes.SELECT,
          replacements: { active: UserStatus.ACTIVE, limit },
        },
      );
      return rows.map((row) => row.userId);
    }
    const where =
      segment === "ACTIVE_CLIENTS"
        ? { status: UserStatus.ACTIVE, role: UserRole.CLIENT }
        : { status: UserStatus.ACTIVE };
    const rows = await this.users.findAll({
      where,
      attributes: ["id"],
      limit,
    });
    return rows.map((row) => row.id);
  }

  async broadcast(input: BroadcastInput): Promise<BroadcastResult> {
    const campaignId = randomUUID();
    const recipients = await this.resolveRecipients(
      input.segment,
      input.maxRecipients,
    );
    let created = 0;
    let duplicates = 0;

    for (const recipientUserId of recipients) {
      const deduplicationKey = `broadcast:${campaignId}:${recipientUserId}`;
      try {
        await this.sequelize.transaction(async (transaction) => {
          const message = await this.repository.createMessage(
            {
              recipientUserId,
              membershipId: null,
              channel: NotificationChannel.IN_APP,
              subject: input.subject,
              body: input.body,
              daysRemaining: null,
              deduplicationKey,
              status: NotificationStatus.PENDING,
              metadata: { kind: "ADVERTISING", campaignId },
            },
            transaction,
          );
          await this.events.recordAndEnqueue(
            {
              eventName: GymDomainEvent.NOTIFICATION_DELIVERY_REQUESTED,
              aggregateType: "notification",
              aggregateId: message.id,
              deduplicationKey: `notification.delivery-requested:${message.id}`,
              payload: {
                notificationId: message.id,
                recipientUserId,
                channel: NotificationChannel.IN_APP,
              },
              metadata: { campaignId, kind: "ADVERTISING" },
            },
            [
              {
                queueName: "notifications.delivery",
                deduplicationKey: `delivery:${deduplicationKey}`,
                payload: { notificationId: message.id },
                availableAt: new Date(),
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

    const result: BroadcastResult = {
      campaignId,
      segment: input.segment,
      recipients: recipients.length,
      created,
      duplicates,
    };
    this.logger.log({ event: "notifications.broadcast.sent", ...result });
    return result;
  }
}
