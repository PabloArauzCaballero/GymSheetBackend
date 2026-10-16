import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Playlists de música de la comunidad: solo ENLACES a Spotify. No se reproduce
 * ni se integra nada; se guarda el enlace normalizado y lo que devuelve el
 * oEmbed público (título y portada) para pintar la tarjeta.
 *
 * - `url` es la forma normalizada (`https://open.spotify.com/<tipo>/<id>`, o el
 *   enlace corto `https://spotify.link/<código>` si no se pudo resolver). El
 *   índice único `(user_id, url)` es lo que hace que el duplicado sea 409 y no
 *   una segunda fila aunque lleguen dos peticiones a la vez.
 * - `tenant_id` no acota el listado público (es global, como el catálogo de
 *   rutinas) pero se guarda para la cola de moderación.
 * - `hidden_*` siguen el mismo contrato que stories y reels: la moderación
 *   oculta de forma reversible sin borrar la fila.
 * - El índice parcial de públicas sirve la paginación por cursor
 *   `(created_at, id)` del listado `scope=public`.
 *
 * También añade `MUSIC_PLAYLIST` a los tipos que se pueden denunciar.
 */
const upStatements = [
  `CREATE TABLE community.music_playlists (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tenant_id varchar(60) NOT NULL,
     url varchar(300) NOT NULL,
     tipo varchar(10) NOT NULL,
     titulo varchar(200) NOT NULL,
     imagen_url text,
     visibilidad varchar(10) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     hidden_at timestamptz,
     hidden_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     hidden_reason varchar(30),
     CONSTRAINT ck_music_playlists_tipo
       CHECK (tipo IN ('playlist','album','track','artist','show')),
     CONSTRAINT ck_music_playlists_visibilidad
       CHECK (visibilidad IN ('PUBLIC','PRIVATE'))
   )`,
  `CREATE UNIQUE INDEX ux_music_playlists_user_url
     ON community.music_playlists (user_id, url)`,
  `CREATE INDEX ix_music_playlists_public_feed
     ON community.music_playlists (created_at DESC, id DESC)
     WHERE visibilidad = 'PUBLIC' AND hidden_at IS NULL`,
  `CREATE INDEX ix_music_playlists_user
     ON community.music_playlists (user_id, created_at DESC, id DESC)`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN ('STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER','ROUTINE','EXERCISE','COMMENT','REEL','MUSIC_PLAYLIST'))`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM moderation.reports WHERE target_kind = 'MUSIC_PLAYLIST') THEN
       RAISE EXCEPTION 'Cannot roll back music playlists while playlist reports exist';
     END IF;
   END
   $$`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN ('STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER','ROUTINE','EXERCISE','COMMENT','REEL'))`,
  `DROP TABLE IF EXISTS community.music_playlists`,
] as const;

export const musicPlaylistsMigration: DatabaseMigration = {
  id: '202610150002-music-playlists',
  description: 'Community music playlists (Spotify links only) and MUSIC_PLAYLIST moderation reports.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
