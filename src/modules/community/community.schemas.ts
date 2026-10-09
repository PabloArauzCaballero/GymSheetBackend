import { z } from 'zod';

export const contentKindParam = z.enum(['ROUTINE', 'EXERCISE']);
export type ContentKind = z.infer<typeof contentKindParam>;

export const ratingSchema = z
  .object({ estrellas: z.number().int().min(1).max(5) })
  .transform((v) => ({ stars: v.estrellas }));

export const commentSchema = z
  .object({
    texto: z.string().trim().min(1).max(1000),
    respuestaA: z.string().uuid().nullable().optional(),
  })
  .transform((v) => ({ text: v.texto, replyToId: v.respuestaA ?? null }));

export const commentListQuerySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RatingInput = z.infer<typeof ratingSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;
