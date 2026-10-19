import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { MusicPlaylistModel, MusicPlaylistVisibility } from './music-playlist.model';
import type { SpotifyContentType } from './spotify-url';

/** Una playlist con su autor, tal como la devuelve la consulta del listado. */
export interface PlaylistRow {
  id: string;
  user_id: string;
  url: string;
  tipo: SpotifyContentType;
  titulo: string;
  imagen_url: string | null;
  visibilidad: MusicPlaylistVisibility;
  created_at: Date;
  /** `created_at` en UTC con microsegundos: es la mitad del cursor y no puede perder precisión. */
  cursor_ts: string;
  full_name: string;
  photo_url: string | null;
}

export type PlaylistCursor = { ts: string; id: string };

export type NewPlaylist = {
  userId: string;
  tenantId: string;
  url: string;
  tipo: SpotifyContentType;
  titulo: string;
  imagenUrl: string | null;
  visibilidad: MusicPlaylistVisibility;
};

const ROW_COLUMNS = `
  p.id, p.user_id, p.url, p.tipo, p.titulo, p.imagen_url, p.visibilidad, p.created_at,
  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
  u.nombre_completo AS full_name,
  photo.url AS photo_url`;

/** Autor y su primera foto visible: mismo criterio que el feed de stories. */
const AUTHOR_JOINS = `
  JOIN public.usuarios u ON u.id = p.user_id
  LEFT JOIN LATERAL (
    SELECT ph.url FROM profile.photos ph
     WHERE ph.user_id = p.user_id AND ph.hidden_at IS NULL
     ORDER BY ph.position ASC LIMIT 1
  ) photo ON true`;

@Injectable()
export class MusicRepository {
  constructor(@InjectModel(MusicPlaylistModel) private readonly playlists: typeof MusicPlaylistModel) {}

  private get sequelize() {
    return this.playlists.sequelize!;
  }

  create(input: NewPlaylist): Promise<MusicPlaylistModel> {
    return this.playlists.create({ ...input });
  }

  existsForUser(userId: string, url: string): Promise<boolean> {
    return this.playlists.count({ where: { userId, url } }).then((count) => count > 0);
  }

  findOwned(id: string, userId: string): Promise<MusicPlaylistModel | null> {
    return this.playlists.findOne({ where: { id, userId } });
  }

  async update(
    playlist: MusicPlaylistModel,
    changes: { visibilidad?: MusicPlaylistVisibility; titulo?: string },
  ): Promise<void> {
    await playlist.update(changes);
  }

  async delete(playlist: MusicPlaylistModel): Promise<void> {
    await playlist.destroy();
  }

  async findRow(id: string): Promise<PlaylistRow | null> {
    const rows = await this.sequelize.query<PlaylistRow>(
      `SELECT ${ROW_COLUMNS} FROM community.music_playlists p ${AUTHOR_JOINS} WHERE p.id = :id`,
      { type: QueryTypes.SELECT, replacements: { id } },
    );
    return rows[0] ?? null;
  }

  /**
   * Públicas de cualquiera, más recientes primero. Fuera: las ocultas por
   * moderación y las de quien yo bloqueé o me bloqueó (el bloqueo es mutuo
   * para la visibilidad). Las mías públicas sí salen.
   *
   * Keyset sobre `(created_at, id)` descendente: estable aunque se publique
   * mientras alguien pagina, y servido por `ix_music_playlists_public_feed`.
   */
  listPublic(viewerId: string, cursor: PlaylistCursor | null, limitPlusOne: number): Promise<PlaylistRow[]> {
    return this.sequelize.query<PlaylistRow>(
      `SELECT ${ROW_COLUMNS}
         FROM community.music_playlists p
         ${AUTHOR_JOINS}
        WHERE p.visibilidad = 'PUBLIC'
          AND p.hidden_at IS NULL
          AND (
            p.user_id = CAST(:viewerId AS uuid)
            OR NOT EXISTS (
              SELECT 1 FROM social.user_blocks b
               WHERE (b.blocker_id = CAST(:viewerId AS uuid) AND b.blocked_id = p.user_id)
                  OR (b.blocker_id = p.user_id AND b.blocked_id = CAST(:viewerId AS uuid))
            )
          )
          ${cursor ? 'AND (p.created_at, p.id) < (CAST(:cursorTs AS timestamptz), CAST(:cursorId AS uuid))' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: { viewerId, limit: limitPlusOne, cursorTs: cursor?.ts ?? null, cursorId: cursor?.id ?? null },
      },
    );
  }

  /** Solo las privadas del propio usuario. Nadie más puede llegar a ellas por aquí. */
  listPrivate(ownerId: string, cursor: PlaylistCursor | null, limitPlusOne: number): Promise<PlaylistRow[]> {
    return this.sequelize.query<PlaylistRow>(
      `SELECT ${ROW_COLUMNS}
         FROM community.music_playlists p
         ${AUTHOR_JOINS}
        WHERE p.user_id = CAST(:ownerId AS uuid)
          AND p.visibilidad = 'PRIVATE'
          ${cursor ? 'AND (p.created_at, p.id) < (CAST(:cursorTs AS timestamptz), CAST(:cursorId AS uuid))' : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: { ownerId, limit: limitPlusOne, cursorTs: cursor?.ts ?? null, cursorId: cursor?.id ?? null },
      },
    );
  }
}
