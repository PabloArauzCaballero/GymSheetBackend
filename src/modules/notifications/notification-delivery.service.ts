import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Sequelize } from 'sequelize-typescript';
import { NotificationStatus } from '../../common/enums/domain.enums';
import { OutboxJobModel } from '../integration/outbox-job.model';
import { NotificationAdapterFactory } from './delivery/notification-adapter.factory';
import { NotificationRepository } from './notification.repository';

const deliveryPayloadSchema = z.object({ notificationId: z.string().uuid() }).strict();

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly adapterFactory: NotificationAdapterFactory,
    private readonly sequelize: Sequelize,
  ) {}

  async deliver(job: OutboxJobModel): Promise<void> {
    const payload = deliveryPayloadSchema.parse(job.payload);
    const message = await this.repository.findMessage(payload.notificationId);
    if (!message) throw new NotFoundException('Notification no longer exists.');
    if ([NotificationStatus.SENT, NotificationStatus.READ].includes(message.status)) return;

    const adapter = this.adapterFactory.forChannel(message.channel);
    const result = await adapter.deliver({
      notificationId: message.id,
      recipientUserId: message.recipientUserId,
      subject: message.subject,
      body: message.body,
      daysRemaining: message.daysRemaining,
      idempotencyKey: job.deduplicationKey,
    });

    await this.sequelize.transaction(async (transaction) => {
      const locked = await this.repository.findMessage(message.id, transaction);
      if (!locked) throw new NotFoundException('Notification no longer exists.');
      await this.repository.createDeliveryAttempt({
        notificationId: locked.id,
        attemptNumber: job.attemptCount,
        provider: result.provider,
        status: NotificationStatus.SENT,
        providerMessageId: result.providerMessageId,
        responseCode: result.responseCode,
        errorCode: null,
        metadata: {},
      }, transaction);
      await this.repository.updateDeliveryState(
        locked,
        { status: NotificationStatus.SENT, sentAt: new Date() },
        transaction,
      );
    });
  }

  async recordFailure(job: OutboxJobModel, error: unknown, deadLetter: boolean) {
    const parsed = deliveryPayloadSchema.safeParse(job.payload);
    if (!parsed.success) return;
    const message = await this.repository.findMessage(parsed.data.notificationId);
    if (!message) return;
    const errorCode = error instanceof Error ? error.name : 'UnknownError';
    await this.sequelize.transaction(async (transaction) => {
      const locked = await this.repository.findMessage(message.id, transaction);
      if (!locked) return;
      await this.repository.createDeliveryAttempt({
        notificationId: locked.id,
        attemptNumber: job.attemptCount,
        provider: 'UNAVAILABLE',
        status: NotificationStatus.FAILED,
        providerMessageId: null,
        responseCode: null,
        errorCode: errorCode.slice(0, 120),
        metadata: {},
      }, transaction);
      await this.repository.updateDeliveryState(
        locked,
        {
          status: deadLetter
            ? NotificationStatus.DEAD_LETTER
            : NotificationStatus.FAILED,
        },
        transaction,
      );
    });
  }
}
