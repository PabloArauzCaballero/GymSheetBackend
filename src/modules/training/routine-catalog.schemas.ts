import { z } from 'zod';
import { TrainingGoal } from '../../common/enums/domain.enums';

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/**
 * Catálogo de rutinas (RF-01). `cursor` es opaco para el cliente. Un cliente
 * antiguo que pida `mine`/`templates` sin `limit` ni `cursor` sigue recibiendo
 * la respuesta paginada por página de siempre (ver `TrainingController.list`).
 */
export const routineCatalogQuerySchema = z.object({
  scope: z.enum(['public', 'official', 'mine', 'shared']),
  q: z.string().trim().min(1).max(80).optional(),
  objetivo: z.nativeEnum(TrainingGoal).optional(),
  diasPorSemana: z.coerce.number().int().min(1).max(7).optional(),
  deMiGimnasio: booleanQuery.optional(),
  orden: z.enum(['recientes', 'valoradas', 'populares']).default('recientes'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RoutineCatalogQuery = z.infer<typeof routineCatalogQuerySchema>;

/** `GET /routines/recommended?limit=3` (§C7). */
export const recommendedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

export type RecommendedQuery = z.infer<typeof recommendedQuerySchema>;

export const encodeCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const offset = (parsed as { o?: unknown }).o;
    return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}
