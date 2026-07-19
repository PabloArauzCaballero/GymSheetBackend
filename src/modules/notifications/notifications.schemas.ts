import { z } from 'zod';
import {
  NotificationChannel,
  NotificationStatus,
} from '../../common/enums/domain.enums';

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 4096,
  'Los metadatos no pueden superar 4 KiB.',
);

export const notificationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.nativeEnum(NotificationStatus).optional(),
});

export const updateNotificationPreferenceSchema = z
  .object({
    recordatoriosVencimiento: z.boolean(),
    canalPreferido: z.enum([
      NotificationChannel.IN_APP,
      NotificationChannel.HTTP_GATEWAY,
    ]),
    consentimientoExternoEn: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    versionConsentimiento: z.string().trim().min(1).max(80).nullable().optional(),
    horaSilencioInicio: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullable()
      .optional(),
    horaSilencioFin: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullable()
      .optional(),
    metadata: metadataSchema.default({}),
  })
  .superRefine((input, context) => {
    if (
      input.canalPreferido === NotificationChannel.HTTP_GATEWAY &&
      (!input.consentimientoExternoEn || !input.versionConsentimiento)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El canal externo requiere consentimiento y versión.',
      });
    }

    const startConfigured = input.horaSilencioInicio != null;
    const endConfigured = input.horaSilencioFin != null;
    if (startConfigured !== endConfigured) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Las dos horas de silencio deben configurarse juntas.',
      });
    }
    if (
      startConfigured &&
      endConfigured &&
      input.horaSilencioInicio === input.horaSilencioFin
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El inicio y fin de silencio deben ser diferentes.',
      });
    }
  })
  .transform((input) => ({
    membershipExpiryEnabled: input.recordatoriosVencimiento,
    preferredChannel: input.canalPreferido,
    externalDeliveryConsentAt: input.consentimientoExternoEn
      ? new Date(input.consentimientoExternoEn)
      : null,
    consentVersion: input.versionConsentimiento ?? null,
    quietHoursStart: input.horaSilencioInicio ?? null,
    quietHoursEnd: input.horaSilencioFin ?? null,
    metadata: input.metadata,
  }));

export type NotificationListInput = z.infer<typeof notificationListSchema>;
export type UpdateNotificationPreferenceInput = z.infer<
  typeof updateNotificationPreferenceSchema
>;
