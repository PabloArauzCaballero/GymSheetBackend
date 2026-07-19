import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { IntegrationModule } from '../integration/integration.module';
import { HttpGatewayNotificationAdapter } from './delivery/http-gateway-notification.adapter';
import { InAppNotificationAdapter } from './delivery/in-app-notification.adapter';
import { MockNotificationAdapter } from './delivery/mock-notification.adapter';
import { NotificationAdapterFactory } from './delivery/notification-adapter.factory';
import { DeliveryAttemptModel } from './delivery-attempt.model';
import { MembershipReminderService } from './membership-reminder.service';
import { NotificationController } from './notification.controller';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPreferenceModel } from './notification-preference.model';
import { NotificationRepository } from './notification.repository';
import { NotificationScheduleService } from './notification-schedule.service';
import { NotificationService } from './notification.service';
import { NotificationModel } from './notification.model';

@Module({
  imports: [
    IntegrationModule,
    SequelizeModule.forFeature([
      NotificationModel,
      NotificationPreferenceModel,
      DeliveryAttemptModel,
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    BusinessDateService,
    NotificationRepository,
    NotificationService,
    MembershipReminderService,
    NotificationScheduleService,
    NotificationDeliveryService,
    InAppNotificationAdapter,
    HttpGatewayNotificationAdapter,
    MockNotificationAdapter,
    NotificationAdapterFactory,
  ],
  exports: [
    NotificationRepository,
    NotificationService,
    MembershipReminderService,
    NotificationDeliveryService,
  ],
})
export class NotificationsModule {}
