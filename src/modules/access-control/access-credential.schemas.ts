import { z } from 'zod';
import { CredentialType } from '../../common/enums/domain.enums';

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 4096,
  'Los metadatos no pueden superar 4 KiB.',
);

export const createPinCredentialSchema = z
  .object({
    usuarioId: z.string().uuid(),
    pin: z.string().regex(/^\d{4,12}$/),
    proveedor: z.string().trim().min(2).max(100).default('INTERNAL_PIN'),
  })
  .strict()
  .transform((input) => ({
    userId: input.usuarioId,
    pin: input.pin,
    provider: input.proveedor,
  }));

export const createExternalCredentialSchema = z
  .object({
    usuarioId: z.string().uuid(),
    modalidad: z.enum([CredentialType.FACE, CredentialType.FINGERPRINT]),
    proveedor: z.string().trim().min(2).max(100),
    referenciaExterna: z.string().trim().min(8).max(255),
    versionConsentimiento: z.string().trim().min(1).max(80),
    consentimientoRegistradoEn: z.string().datetime({ offset: true }),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .transform((input) => ({
    userId: input.usuarioId,
    credentialType: input.modalidad,
    provider: input.proveedor,
    externalReference: input.referenciaExterna,
    consentVersion: input.versionConsentimiento,
    consentRecordedAt: new Date(input.consentimientoRegistradoEn),
    metadata: input.metadata,
  }));

export const revokeCredentialSchema = z.object({
  motivo: z.string().trim().min(3).max(1000).nullable().optional(),
});

export type CreatePinCredentialInput = z.infer<typeof createPinCredentialSchema>;
export type CreateExternalCredentialInput = z.infer<typeof createExternalCredentialSchema>;
export type RevokeCredentialInput = z.infer<typeof revokeCredentialSchema>;
