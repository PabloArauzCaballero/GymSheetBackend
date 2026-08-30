import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Registro de visitas al perfil: una fila por vista, append-only — el
 * resumen ("cuántas personas hoy") se calcula agregando en lectura
 * (`COUNT(DISTINCT viewer_id)`), no manteniendo un contador aparte.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS profile.profile_views (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     viewer_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     viewed_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tenant_id varchar(60) NOT NULL,
     viewed_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_profile_views_not_self CHECK (viewer_id <> viewed_user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_profile_views_viewed_user ON profile.profile_views (viewed_user_id, viewed_at)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS profile.profile_views`] as const;

export const profileViewsMigration: DatabaseMigration = {
  id: "202608280002-profile-views",
  description: "Adds profile.profile_views, an append-only log of who viewed whose profile and when.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
