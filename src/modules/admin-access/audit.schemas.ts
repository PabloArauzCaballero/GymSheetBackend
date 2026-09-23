import { z } from 'zod';

/** Tope por página: el historial se navega con «cargar más», no de 500 en 500. */
const MAX_PAGE_SIZE = 100;

export const auditLogQuerySchema = z
  .object({
    actorUserId: z.string().uuid().optional(),
    domain: z.string().trim().min(1).max(60).optional(),
    action: z.string().trim().min(1).max(60).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
    cursor: z.string().min(1).max(200).optional(),
  })
  .transform((input) => ({
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.domain ? { domain: input.domain } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.from ? { from: new Date(input.from) } : {}),
    ...(input.to ? { to: new Date(input.to) } : {}),
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }));

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
