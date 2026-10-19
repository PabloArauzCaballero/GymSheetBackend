import { z } from 'zod';

const visibilidadSchema = z.enum(['PUBLIC', 'PRIVATE']);
const tituloSchema = z.string().trim().min(1).max(120);

export const playlistListQuerySchema = z.object({
  scope: z.enum(['public', 'private']).default('public'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * `url` solo se acota aquí; reconocerla como enlace de Spotify es del servicio,
 * que responde `MUSIC_URL_INVALID` con un mensaje propio en vez del genérico.
 */
export const createPlaylistSchema = z.object({
  url: z.string().max(500),
  visibilidad: visibilidadSchema,
  titulo: tituloSchema.optional(),
});

export const updatePlaylistSchema = z.object({
  visibilidad: visibilidadSchema.optional(),
  titulo: tituloSchema.optional(),
});

export type PlaylistListQuery = z.infer<typeof playlistListQuerySchema>;
export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;
export type UpdatePlaylistInput = z.infer<typeof updatePlaylistSchema>;
