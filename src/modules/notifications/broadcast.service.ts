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
import { tenantScopeWhere } from "../../common/tenancy/tenant-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
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

  /**
   * Destinatarios de una campaña, acotados al gimnasio que la lanza.
   *
   * Es el filtro más importante del módulo: sin él, un administrador de un
   * gimnasio le escribía a los socios de TODOS los gimnasios de la instalación.
   * A diferencia de una fuga de lectura, esto no se queda en la respuesta —
   * crea un mensaje y encola su entrega—, así que no había forma de deshacerlo.
   *
   * `null` (plataforma sin suplantar) no filtra: es el único caso en el que
   * escribir a toda la instalación es la intención.
   */
  private async resolveRecipients(
    segment: BroadcastSegment,
    limit: number,
    tenantScope: string | null,
  ): Promise<string[]> {
    if (segment === "ACTIVE_MEMBERS") {
      const rows = await this.sequelize.query<{ userId: string }>(
        `SELECT DISTINCT m.user_id AS "userId"
         FROM membership.memberships m
         JOIN public.usuarios u ON u.id = m.user_id
         WHERE m.status = 'ACTIVE' AND u.estado = :active
           AND (:tenantScope::text IS NULL OR u.tenant_id = :tenantScope)
         LIMIT :limit`,
        {
          type: QueryTypes.SELECT,
          replacements: { active: UserStatus.ACTIVE, limit, tenantScope },
        },
      );
      return rows.map((row) => row.userId);
    }
    const where = {
      ...(segment === "ACTIVE_CLIENTS"
        ? { status: UserStatus.ACTIVE, role: UserRole.CLIENT }
        : { status: UserStatus.ACTIVE }),
      ...tenantScopeWhere(tenantScope),
    };
    const rows = await this.users.findAll({
      where,
      attributes: ["id"],
      limit,
    });
    return rows.map((row) => row.id);
  }

  async broadcast(
    actor: AuthenticatedUser,
    input: BroadcastInput,
  ): Promise<BroadcastResult> {
    const campaignId = randomUUID();
    const recipients = await this.resolveRecipients(
      input.segment,
      input.maxRecipients,
      actor.tenantScope,
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
    // Queda en el registro quién lanzó la campaña y sobre qué gimnasio: una
    // campaña no se puede retirar una vez entregada, así que la trazabilidad
    // es lo único que queda para responder «¿quién mandó esto?».
    this.logger.log({
      event: "notifications.broadcast.sent",
      actorUserId: actor.id,
      tenantScope: actor.tenantScope,
      ...result,
    });
    return result;
  }
}
