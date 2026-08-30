import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Stories estilo Instagram/WhatsApp: foto o video que expira a las 24h.
 * `tenant_id` se copia al crear la story (no se resuelve por join contra
 * `usuarios` en cada lectura) para que el feed filtre por un solo índice
 * — igual de válido porque el tenant de una cuenta prácticamente no cambia,
 * y si cambiara, sus stories viejas ya habrán expirado de todos modos.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS profile.stories (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tenant_id varchar(60) NOT NULL,
     media_url text NOT NULL,
     storage_provider varchar(20) NOT NULL,
     storage_key text NOT NULL,
     media_type varchar(10) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL,
     CONSTRAINT ck_profile_stories_media_type CHECK (media_type IN ('image', 'video'))
   )`,
  `CREATE INDEX IF NOT EXISTS ix_profile_stories_user ON profile.stories (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_profile_stories_feed ON profile.stories (tenant_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS profile.story_views (
     story_id uuid NOT NULL REFERENCES profile.stories(id) ON DELETE CASCADE,
     viewer_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     viewed_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (story_id, viewer_id)
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS profile.story_views`,
  `DROP TABLE IF EXISTS profile.stories`,
] as const;

export const profileStoriesMigration: DatabaseMigration = {
  id: "202608280001-profile-stories",
  description: "Adds profile.stories and profile.story_views for 24h ephemeral photo/video stories.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
