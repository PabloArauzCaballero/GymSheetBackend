import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Múltiples fotos de perfil.
 *
 * Hoy no existe ni un avatar único: el perfil solo muestra iniciales. Esta
 * tabla es deliberadamente independiente de `perfiles_antropometricos` (no
 * es una medida corporal, es contenido) y de `admin.media` (esa es la
 * mediateca administrada por el gimnasio; esto lo sube cada socio sobre su
 * propia cuenta). `position` ordena la galería; no hay límite a nivel de base
 * de datos porque el límite (seis fotos) es una regla de producto, no de
 * integridad, y vive en el servicio.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS profile.photos (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     url text NOT NULL,
     storage_provider varchar(20) NOT NULL,
     storage_key text NOT NULL,
     position smallint NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ix_profile_photos_user ON profile.photos (user_id, position)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS profile.photos`] as const;

export const profilePhotosMigration: DatabaseMigration = {
  id: "202608250006-profile-photos",
  description: "Per-user profile photo gallery, independent from the admin media catalogue.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
