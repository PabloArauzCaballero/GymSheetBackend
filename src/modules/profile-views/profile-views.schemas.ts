import { z } from "zod";
import { MAX_CURSOR_LENGTH } from "./profile-views.cursor";

export const recordProfileViewSchema = z.object({
  viewedUserId: z.string().uuid(),
});
export type RecordProfileViewInput = z.infer<typeof recordProfileViewSchema>;

/**
 * Página de "quién vio mi perfil".
 *
 * El tope (50) es el mismo que el del directorio: la lista se pinta con foto y
 * nombre, así que pedir más filas es traer datos que no caben en pantalla.
 * `cursor` se valida aquí sólo en forma y tamaño; su contenido lo descifra y
 * valida `decodeProfileViewersCursor`, que es quien sabe qué hay dentro.
 */
export const profileViewersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
});
export type ProfileViewersQuery = z.infer<typeof profileViewersQuerySchema>;
