import { z } from 'zod';
import { AccessDecisionOutcome, AccessDirection, AccessDeviceStatus } from '../../common/enums/domain.enums';

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 8192,
  'Los metadatos no pueden superar 8 KiB.',
);

export const createDeviceSchema = z
  .object({
    puntoAccesoId: z.string().uuid(),
    adapterKey: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9._-]+$/),
    dispositivoExternoId: z.string().trim().min(2).max(180),
    nombre: z.string().trim().min(2).max(180),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    accessPointId: input.puntoAccesoId,
    adapterKey: input.adapterKey,
    externalDeviceId: input.dispositivoExternoId,
    name: input.nombre,
    metadata: input.metadata,
  }));

export const updateDeviceStatusSchema = z
  .object({ estado: z.nativeEnum(AccessDeviceStatus) })
  .transform((input) => ({ status: input.estado }));

export const canonicalAccessEventSchema = z
  .object({
    dispositivoId: z.string().uuid(),
    credencialId: z.string().uuid(),
    eventoOrigenId: z.string().trim().min(8).max(200),
    direccion: z.enum([AccessDirection.ENTRY, AccessDirection.EXIT]),
    ocurridoEn: z.string().datetime({ offset: true }),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    deviceId: input.dispositivoId,
    credentialId: input.credencialId,
    sourceEventId: input.eventoOrigenId,
    requestedDirection: input.direccion,
    occurredAt: new Date(input.ocurridoEn),
    metadata: input.metadata,
  }));

export const accessHistoryFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  usuarioId: z.string().uuid().optional(),
  resultado: z.nativeEnum(AccessDecisionOutcome).optional(),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceStatusInput = z.infer<typeof updateDeviceStatusSchema>;
export type CanonicalAccessEventInput = z.infer<typeof canonicalAccessEventSchema>;
export type AccessHistoryFilterInput = z.infer<typeof accessHistoryFilterSchema>;
