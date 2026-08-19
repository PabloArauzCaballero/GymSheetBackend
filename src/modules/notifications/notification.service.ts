import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { UniqueConstraintError } from 'sequelize';
import { NotificationChannel, NotificationStatus } from '../../common/enums/domain.enums';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { BusinessDateService } from '../../common/time/business-date.service';
import { env } from '../../config/env';
import { mapNotification, mapNotificationPreference } from './notification.mapper';
import { NotificationRepository } from './notification.repository';
import { NotificationListInput, UpdateNotificationPreferenceInput } from './notifications.schemas';

@Injectable()
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly dates: BusinessDateService,
    private readonly events: DomainEventPublisher,
    private readonly sequelize: Sequelize,
  ) {}

  /**
   * Encola un mensaje para una persona por el canal que se indique.
   *
   * Es el caso de uso que faltaba: hasta ahora sólo existían el recordatorio de
   * membresía y la difusión, cada uno con su propia copia de este baile de
   * `messages` + evento de dominio + trabajo en el outbox. Cualquier otra parte
   * de la aplicación que quisiera avisar a alguien tenía que replicarlo, y ahí
   * es donde se pierde la garantía de entrega: basta olvidar el outbox una vez
   * para que un aviso se envíe fuera de la transacción y desaparezca si algo
   * falla después.
   *
   * El canal es un parámetro, no una decisión de aquí. Quien llama sabe si un
   * mensaje merece un correo o basta con verlo al abrir la app; el puerto de
   * entrega ya sabe cómo hacer cada cosa.
   *
   * Devuelve `false` si la clave de deduplicación ya existía. No es un error:
   * significa que ese mensaje ya se encoló, que es justo lo que la clave está
   * para garantizar.
   */
  async enqueueDirectMessage(input: {
    recipientUserId: string;
    channel: NotificationChannel;
    subject: string | null;
    body: string;
    deduplicationKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.sequelize.transaction(async (transaction) => {
        const message = await this.repository.createMessage(
          {
            recipientUserId: input.recipientUserId,
            membershipId: null,
            channel: input.channel,
            subject: input.subject,
            body: input.body,
            daysRemaining: null,
            deduplicationKey: input.deduplicationKey,
            status: NotificationStatus.PENDING,
            metadata: input.metadata ?? {},
          },
          transaction,
        );
        // El evento y el trabajo del outbox se escriben en la misma
        // transacción que el mensaje: o existe todo, o no existe nada. Un
        // envío disparado fuera de la transacción es el clásico aviso que se
        // manda de una operación que luego se deshizo.
        await this.events.recordAndEnqueue(
          {
            eventName: GymDomainEvent.NOTIFICATION_DELIVERY_REQUESTED,
            aggregateType: 'notification',
            aggregateId: message.id,
            deduplicationKey: `notification.delivery-requested:${message.id}`,
            payload: {
              notificationId: message.id,
              recipientUserId: input.recipientUserId,
              channel: input.channel,
            },
            metadata: input.metadata ?? {},
          },
          [
            {
              queueName: 'notifications.delivery',
              deduplicationKey: `delivery:${input.deduplicationKey}`,
              payload: { notificationId: message.id },
              availableAt: new Date(),
            },
          ],
          transaction,
        );
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
  }

  async listMine(userId: string, filters: NotificationListInput) {
    const result = await this.repository.listForUser(userId, filters);
    return {
      items: result.rows.map(mapNotification),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / filters.pageSize),
      fechaNegocio: this.dates.today(),
    };
  }

  async markMineRead(userId: string, notificationId: string) {
    const message = await this.repository.findForUser(notificationId, userId);
    if (!message) throw new NotFoundException('Notificación no encontrada.');
    return mapNotification(await this.repository.markRead(message));
  }

  async getMyPreference(userId: string) {
    return mapNotificationPreference(await this.repository.findPreference(userId));
  }

  async updateMyPreference(userId: string, input: UpdateNotificationPreferenceInput) {
    if (
      input.preferredChannel === NotificationChannel.HTTP_GATEWAY &&
      !['HTTP_GATEWAY', 'MOCK'].includes(env.NOTIFICATION_DELIVERY_PROVIDER)
    ) {
      throw new UnprocessableEntityException(
        'El canal externo no está habilitado en este entorno.',
      );
    }
    return mapNotificationPreference(await this.repository.upsertPreference(userId, input));
  }
}
