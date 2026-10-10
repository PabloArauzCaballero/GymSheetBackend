import { z } from 'zod';
import {
  ModerationReason,
  ModerationTargetKind,
} from './moderation.policy';

const targetKindSchema = z.nativeEnum(ModerationTargetKind);
const reasonSchema = z.nativeEnum(ModerationReason);

export const createReportSchema = z.object({
  targetKind: targetKindSchema,
  targetId: z.string().uuid(),
  reason: reasonSchema,
  /**
   * Texto libre del denunciante, acotado.
   *
   * Lo lee una persona en la cola, no una máquina: mil caracteres es más de lo
   * que nadie escribe desde el móvil y menos de lo que convierte la tarjeta en
   * un muro de texto que se salta.
   */
  details: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const moderationQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type ModerationQueueQuery = z.infer<typeof moderationQueueQuerySchema>;

export const caseParamsSchema = z.object({
  targetKind: targetKindSchema,
  targetId: z.string().uuid(),
});

export type CaseParams = z.infer<typeof caseParamsSchema>;

/**
 * El veredicto.
 *
 * `sanction` es un booleano y no una duración: **quién modera decide SI se
 * sanciona, el sistema decide CUÁNTO**. Dejar elegir los días reabriría por la
 * puerta de atrás la arbitrariedad que la escalera existe para cerrar — dos
 * personas con el mismo historial acabarían con castigos distintos según quién
 * miró su caso.
 */
export const resolveCaseSchema = z.object({
  /** Retirar el contenido. Independiente de sancionar: se puede hacer sólo esto. */
  hideContent: z.boolean().default(false),
  /** Emitir la sanción que toque por historial. */
  sanction: z.boolean().default(false),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export type ResolveCaseInput = z.infer<typeof resolveCaseSchema>;
