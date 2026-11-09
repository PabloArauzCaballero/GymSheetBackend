import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Ubicación de cada sede gestionada desde la consola.
 *
 * Las coordenadas (`latitude`, `longitude`, `numeric(9,6)`) ya existen desde
 * `202608250003-streak-geo-verification`, pero nada las escribía salvo la
 * siembra. Ahora la consola dibuja las sedes en un mapa y el administrador
 * elige el punto al darlas de alta; aquí solo se añade la dirección legible y
 * las reglas que esa escritura necesita.
 *
 * - `address` es opcional: las sedes existentes quedan «sin dirección».
 * - Latitud y longitud van juntas o no van: un punto con una sola coordenada
 *   no se puede dibujar ni sirve para la verificación de racha.
 * - Rango WGS84; `numeric(9,6)` admitiría hasta ±999.
 *
 * Las restricciones se crean `NOT VALID`: rigen para toda escritura nueva sin
 * hacer fallar el despliegue si alguna fila antigua las incumpliera. Validarlas
 * después es `ALTER TABLE ... VALIDATE CONSTRAINT`.
 */
const upStatements = [
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS address varchar(300)`,
  `ALTER TABLE facilities.branches
     ADD CONSTRAINT ck_branches_coordinates_pair
     CHECK ((latitude IS NULL) = (longitude IS NULL)) NOT VALID`,
  `ALTER TABLE facilities.branches
     ADD CONSTRAINT ck_branches_coordinates_range
     CHECK (
       (latitude IS NULL OR latitude BETWEEN -90 AND 90)
       AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
     ) NOT VALID`,
  `ALTER TABLE facilities.branches
     ADD CONSTRAINT ck_branches_geofence_radius
     CHECK (geofence_radius_m IS NULL OR geofence_radius_m BETWEEN 20 AND 5000) NOT VALID`,
] as const;

const downStatements = [
  `ALTER TABLE facilities.branches DROP CONSTRAINT IF EXISTS ck_branches_geofence_radius`,
  `ALTER TABLE facilities.branches DROP CONSTRAINT IF EXISTS ck_branches_coordinates_range`,
  `ALTER TABLE facilities.branches DROP CONSTRAINT IF EXISTS ck_branches_coordinates_pair`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS address`,
] as const;

export const branchLocationMigration: DatabaseMigration = {
  id: "202611080001-branch-location",
  description:
    "Branch address plus pair/range checks so the admin console can write branch coordinates.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
