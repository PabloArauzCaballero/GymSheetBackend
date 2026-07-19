import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { IntegrationModule } from '../integration/integration.module';
import { DeliveryAttemptModel } from './delivery-attempt.model';
import { MembershipReminderService } from './membership-reminder.service';
import { NotificationController } from './notification.controller';
import { NotificationPreferenceModel } from './notification-preference.model';
import { NotificationRepository } from './notification.repository';
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
  ],
  exports: [
    NotificationRepository,
    NotificationService,
    MembershipReminderService,
  ],
})
export class NotificationsModule {}
