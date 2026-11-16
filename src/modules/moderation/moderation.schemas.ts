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

/**
 * Keyset cursor of «Tus denuncias»: the last row's `createdAt` and `id`.
 * `createdAt` is the ISO text PostgreSQL printed, with microseconds: a JS Date
 * would round to milliseconds and repeat or skip a row at the page boundary.
 */
export type MyReportsCursor = { createdAt: string; id: string };

const myReportsCursorPayloadSchema = z.object({
  c: z.string().datetime(),
  i: z.string().uuid(),
});

export function encodeMyReportsCursor(cursor: MyReportsCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id }), 'utf8').toString('base64url');
}

function decodeMyReportsCursor(raw: string): MyReportsCursor | null {
  try {
    const parsed = myReportsCursorPayloadSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? { createdAt: parsed.data.c, id: parsed.data.i } : null;
  } catch {
    return null;
  }
}

export const myReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z
    .string()
    .max(200)
    .optional()
    .transform((value, context) => {
      if (value === undefined || value === '') return null;
      const cursor = decodeMyReportsCursor(value);
      if (!cursor) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cursor inválido.' });
        return z.NEVER;
      }
      return cursor;
    }),
});

export type MyReportsQuery = z.infer<typeof myReportsQuerySchema>;
