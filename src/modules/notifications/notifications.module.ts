import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { env } from '../../config/env';
import { IntegrationModule } from '../integration/integration.module';
import { UserModel } from '../users/user.model';
import { AdminBroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { EmailNotificationAdapter } from './delivery/email-notification.adapter';
import { HttpGatewayNotificationAdapter } from './delivery/http-gateway-notification.adapter';
import { LogMailTransport } from './delivery/log-mail.transport';
import { MAIL_TRANSPORT } from './delivery/mail.transport';
import { SmtpMailTransport } from './delivery/smtp-mail.transport';
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
      UserModel,
    ]),
  ],
  controllers: [NotificationController, AdminBroadcastController],
  providers: [
    BusinessDateService,
    NotificationRepository,
    NotificationService,
    BroadcastService,
    MembershipReminderService,
    NotificationScheduleService,
    NotificationDeliveryService,
    InAppNotificationAdapter,
    EmailNotificationAdapter,
    HttpGatewayNotificationAdapter,
    LogMailTransport,
    SmtpMailTransport,
    {
      // El transporte se elige una vez, al arrancar, y no en cada envío: qué
      // buzón usa este despliegue es configuración, no una decisión que deba
      // repetirse por correo. Ambas implementaciones se registran para que la
      // elección sea un cambio de variable de entorno y no de código.
      provide: MAIL_TRANSPORT,
      inject: [LogMailTransport, SmtpMailTransport],
      useFactory: (log: LogMailTransport, smtp: SmtpMailTransport) =>
        env.MAIL_TRANSPORT === 'SMTP' ? smtp : log,
    },
    MockNotificationAdapter,
    NotificationAdapterFactory,
  ],
  exports: [
    MAIL_TRANSPORT,
    NotificationRepository,
    NotificationService,
    MembershipReminderService,
    NotificationDeliveryService,
  ],
})
export class NotificationsModule {}
