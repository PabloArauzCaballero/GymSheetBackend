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
import { GmailMailTransport } from './delivery/gmail-mail.transport';
import { LogMailTransport } from './delivery/log-mail.transport';
import { MAIL_TRANSPORT } from './delivery/mail.transport';
import { SmtpMailTransport } from './delivery/smtp-mail.transport';
import { InAppNotificationAdapter } from './delivery/in-app-notification.adapter';
import { MockNotificationAdapter } from './delivery/mock-notification.adapter';
import { ExpoPushTransport } from './delivery/expo-push.transport';
import { PushDispatcherService } from './delivery/push-dispatcher.service';
import { PUSH_TRANSPORTS, PushTransport } from './delivery/push.transport';
import { createWebPushTransport } from './delivery/push-transport.factory';
import { NotificationAdapterFactory } from './delivery/notification-adapter.factory';
import { DeliveryAttemptModel } from './delivery-attempt.model';
import { DeviceTokenModel } from './device-token.model';
import { DeviceTokenRepository } from './device-token.repository';
import { DeviceTokenService } from './device-token.service';
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
      DeviceTokenModel,
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
    DeviceTokenRepository,
    DeviceTokenService,
    ExpoPushTransport,
    {
      // La lista de transportes se arma UNA vez al arrancar, y el despachador
      // deriva de ella su tabla de rutas por plataforma. Expo siempre está: no
      // necesita configuración local porque las credenciales de FCM/APNs viven
      // en el proyecto de EAS. El de web sólo si este despliegue lo pidió, y si
      // lo pidió mal el factory detiene el arranque (ADR-0011).
      provide: PUSH_TRANSPORTS,
      inject: [ExpoPushTransport],
      useFactory: (expo: ExpoPushTransport): PushTransport[] => {
        const web = createWebPushTransport({
          transport: env.WEB_PUSH_TRANSPORT,
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          allowedHosts: env.WEB_PUSH_ALLOWED_HOSTS,
          timeoutMs: env.WEB_PUSH_TIMEOUT_MS,
          ttlSeconds: env.WEB_PUSH_TTL_SECONDS,
        });
        return web ? [expo, web] : [expo];
      },
    },
    PushDispatcherService,
    InAppNotificationAdapter,
    EmailNotificationAdapter,
    HttpGatewayNotificationAdapter,
    LogMailTransport,
    SmtpMailTransport,
    GmailMailTransport,
    {
      // El transporte se elige una vez, al arrancar, y no en cada envío: qué
      // buzón usa este despliegue es configuración, no una decisión que deba
      // repetirse por correo. Ambas implementaciones se registran para que la
      // elección sea un cambio de variable de entorno y no de código.
      provide: MAIL_TRANSPORT,
      inject: [LogMailTransport, SmtpMailTransport, GmailMailTransport],
      useFactory: (
        log: LogMailTransport,
        smtp: SmtpMailTransport,
        gmail: GmailMailTransport,
      ) => {
        if (env.MAIL_TRANSPORT === 'SMTP') return smtp;
        if (env.MAIL_TRANSPORT === 'GMAIL') return gmail;
        return log;
      },
    },
    MockNotificationAdapter,
    NotificationAdapterFactory,
  ],
  exports: [
    MAIL_TRANSPORT,
    // El chat lo necesita para avisar a quien no tiene la app abierta; es el
    // único consumidor fuera de este módulo.
    ExpoPushService,
    NotificationRepository,
    NotificationService,
    MembershipReminderService,
    NotificationDeliveryService,
  ],
})
export class NotificationsModule {}
