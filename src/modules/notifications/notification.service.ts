import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { NotificationChannel } from '../../common/enums/domain.enums';
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
  ) {}

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
