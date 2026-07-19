import { NotificationPreferenceModel } from './notification-preference.model';
import { NotificationModel } from './notification.model';

export function mapNotification(message: NotificationModel) {
  return {
    id: message.id,
    membresiaId: message.membershipId,
    canal: message.channel,
    asunto: message.subject,
    mensaje: message.body,
    diasRestantes: message.daysRemaining,
    estado: message.status,
    leidoEn: message.readAt,
    enviadoEn: message.sentAt,
    creadoEn: message.createdAt,
  };
}

export function mapNotificationPreference(preference: NotificationPreferenceModel | null) {
  return preference
    ? {
        recordatoriosVencimiento: preference.membershipExpiryEnabled,
        canalPreferido: preference.preferredChannel,
        consentimientoExternoEn: preference.externalDeliveryConsentAt,
        versionConsentimiento: preference.consentVersion,
        horaSilencioInicio: preference.quietHoursStart,
        horaSilencioFin: preference.quietHoursEnd,
      }
    : {
        recordatoriosVencimiento: true,
        canalPreferido: 'IN_APP' as const,
        consentimientoExternoEn: null,
        versionConsentimiento: null,
        horaSilencioInicio: null,
        horaSilencioFin: null,
      };
}
