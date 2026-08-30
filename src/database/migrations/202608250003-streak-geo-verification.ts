import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Verificación de racha por geolocalización.
 *
 * Decisión de producto del audit: se verifica solo desde el móvil, de forma
 * transparente (sin pedir nada extra al usuario, sin bloquear la sesión si
 * falla). Por eso esto es aditivo puro — dos columnas nuevas en `branches` que
 * quedan nulas hasta que el gimnasio las configure, y dos en las sesiones de
 * entrenamiento que quedan en su valor por defecto si el cliente no manda
 * ubicación o si ninguna sede está dentro del radio. Nada existente cambia de
 * comportamiento.
 */
const upStatements = [
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS latitude numeric(9,6)`,
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS longitude numeric(9,6)`,
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS geofence_radius_m integer`,
  `ALTER TABLE public.sesiones_entrenamiento
     ADD COLUMN IF NOT EXISTS geo_verified boolean NOT NULL DEFAULT false`,
  `ALTER TABLE public.sesiones_entrenamiento
     ADD COLUMN IF NOT EXISTS verified_branch_id uuid REFERENCES facilities.branches(id)`,
] as const;

const downStatements = [
  `ALTER TABLE public.sesiones_entrenamiento DROP COLUMN IF EXISTS verified_branch_id`,
  `ALTER TABLE public.sesiones_entrenamiento DROP COLUMN IF EXISTS geo_verified`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS geofence_radius_m`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS longitude`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS latitude`,
] as const;

export const streakGeoVerificationMigration: DatabaseMigration = {
  id: "202608250003-streak-geo-verification",
  description:
    "Optional branch coordinates and a geo-verified flag on finished workout sessions.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
