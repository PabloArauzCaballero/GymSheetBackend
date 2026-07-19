import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IntegrationModule } from '../modules/integration/integration.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { MembershipReminderRunner } from './membership-reminder.runner';
import { NotificationDeliveryRunner } from './notification-delivery.runner';

@Module({
  imports: [DatabaseModule, IntegrationModule, NotificationsModule],
  providers: [MembershipReminderRunner, NotificationDeliveryRunner],
})
export class NotificationWorkerModule {}
