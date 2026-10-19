import { shortenName } from '../social/social.mapper';
import type { MusicPlaylistVisibility } from './music-playlist.model';
import type { PlaylistCursor, PlaylistRow } from './music.repository';
import type { SpotifyContentType } from './spotify-url';

export type MusicPlaylistResponse = {
  id: string;
  url: string;
  tipo: SpotifyContentType;
  titulo: string;
  imagenUrl: string | null;
  visibilidad: MusicPlaylistVisibility;
  esMia: boolean;
  /** ISO 8601. */
  creadaEn: string;
  autor: { id: string; displayName: string; avatarUrl: string | null };
};

export type MusicPlaylistPage = { items: MusicPlaylistResponse[]; nextCursor: string | null };

export function mapPlaylistRow(row: PlaylistRow, viewerId: string): MusicPlaylistResponse {
  return {
    id: row.id,
    url: row.url,
    tipo: row.tipo,
    titulo: row.titulo,
    imagenUrl: row.imagen_url,
    visibilidad: row.visibilidad,
    esMia: row.user_id === viewerId,
    creadaEn: new Date(row.created_at).toISOString(),
    // Nombre de pila e inicial, como el directorio social: el listado público
    // cruza gimnasios y no es un padrón de socios con nombre completo.
    autor: { id: row.user_id, displayName: shortenName(row.full_name), avatarUrl: row.photo_url },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Cursor opaco: `base64url("<created_at con µs>|<id>")`. */
export function encodePlaylistCursor(row: PlaylistRow): string {
  return Buffer.from(`${row.cursor_ts}|${row.id}`, 'utf8').toString('base64url');
}

/** `null` si el cursor no es uno que hayamos emitido; el servicio lo traduce a 400. */
export function decodePlaylistCursor(raw: string): PlaylistCursor | null {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const [ts, id, extra] = decoded.split('|');
  if (extra !== undefined || !ts || !id || !CURSOR_TS.test(ts) || !UUID.test(id)) return null;
  return { ts, id };
}
