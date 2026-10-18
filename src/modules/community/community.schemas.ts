import { z } from 'zod';

export const contentKindParam = z.enum(['ROUTINE', 'EXERCISE']);
export type ContentKind = z.infer<typeof contentKindParam>;

export const ratingSchema = z
  .object({ estrellas: z.number().int().min(1).max(5) })
  .transform((v) => ({ stars: v.estrellas }));

export const attachmentKinds = ['GIF', 'STICKER', 'IMAGEN', 'VIDEO', 'ARCHIVO'] as const;

export const attachmentSchema = z.object({
  tipo: z.enum(attachmentKinds),
  url: z.string().url().max(1000),
  mime: z.string().max(100).nullish(),
  nombre: z.string().trim().max(200).nullish(),
  bytes: z.number().int().min(0).max(104857600).nullish(),
  ancho: z.number().int().min(1).max(10000).nullish(),
  alto: z.number().int().min(1).max(10000).nullish(),
});

export const commentSchema = z
  .object({
    texto: z.string().trim().max(1000).default(''),
    respuestaA: z.string().uuid().nullable().optional(),
    adjunto: attachmentSchema.nullish(),
  })
  .refine((v) => v.texto.length > 0 || v.adjunto, { message: 'Escribe algo o adjunta un archivo.', path: ['texto'] })
  .transform((v) => ({ text: v.texto, replyToId: v.respuestaA ?? null, attachment: v.adjunto ?? null }));

export const gifSearchQuerySchema = z.object({
  q: z.string().trim().max(60).default(''),
  tipo: z.enum(['gifs', 'stickers']).default('gifs'),
  pos: z.coerce.number().int().min(0).max(4999).default(0),
});

export type AttachmentInput = z.infer<typeof attachmentSchema>;
export type GifSearchQuery = z.infer<typeof gifSearchQuerySchema>;

/** `recientes`: los más nuevos primero. `utiles`: los que más «me gusta» tienen, y a igualdad los más nuevos. */
export const commentOrders = ['recientes', 'utiles'] as const;
export type CommentOrder = (typeof commentOrders)[number];

export const commentListQuerySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  orden: z.enum(commentOrders).default('recientes'),
});

export type RatingInput = z.infer<typeof ratingSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;
