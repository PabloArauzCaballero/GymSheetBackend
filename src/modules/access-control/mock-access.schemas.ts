import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccessDirection } from '../../common/enums/domain.enums';

/**
 * Development-only event simulator. It accepts internal identifiers only and
 * never accepts a PIN, image, fingerprint sample, or external template.
 */
export const mockAccessEventSchema = z
  .object({
    dispositivoId: z.string().uuid(),
    credencialId: z.string().uuid(),
    eventoOrigenId: z.string().trim().min(8).max(200).optional(),
    direccion: z.enum([AccessDirection.ENTRY, AccessDirection.EXIT]),
    ocurridoEn: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .transform((input) => ({
    deviceId: input.dispositivoId,
    credentialId: input.credencialId,
    sourceEventId: input.eventoOrigenId ?? `mock-${randomUUID()}`,
    requestedDirection: input.direccion,
    occurredAt: input.ocurridoEn ? new Date(input.ocurridoEn) : new Date(),
    metadata: { source: 'MOCK_ADAPTER' },
  }));

export type MockAccessEventInput = z.infer<typeof mockAccessEventSchema>;
