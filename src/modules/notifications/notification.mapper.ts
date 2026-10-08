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
    ...mapNotificationRouting(message.metadata),
  };
}

/**
 * Tipo y referencias para que el cliente sepa a dónde abrir el aviso. Solo se
 * exponen estos dos campos de `metadata`: el resto es interno.
 */
function mapNotificationRouting(metadata: Record<string, unknown> | null | undefined) {
  const type = typeof metadata?.type === 'string' ? metadata.type : null;
  const refs =
    metadata?.refs && typeof metadata.refs === 'object' ? (metadata.refs as Record<string, unknown>) : {};
  return { tipo: type, referencias: refs };
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
