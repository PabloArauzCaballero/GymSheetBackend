import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Retira `ejercicios.equipo_id`.
 *
 * Se añadió para poder informar del uso por máquina sin advertir que el
 * catálogo ya relacionaba ejercicios y equipos por `ejercicios_equipos`, que
 * además admite varios —una prensa y su barra— y ya está expuesta en la API con
 * `equipoIds`. Dos formas de decir lo mismo se desincronizan siempre, y la que
 * sobra es la que nadie escribe.
 *
 * El informe de uso pasa a leer la tabla de relación. Nada se pierde: la
 * columna nunca llegó a poblarse.
 */
const upStatements = [
  `DROP INDEX IF EXISTS ix_ejercicios_equipo`,
  `ALTER TABLE ejercicios DROP COLUMN IF EXISTS equipo_id`,
] as const;

const downStatements = [
  `ALTER TABLE ejercicios
     ADD COLUMN equipo_id uuid REFERENCES equipos_gym (id) ON DELETE SET NULL`,
  `CREATE INDEX ix_ejercicios_equipo ON ejercicios (equipo_id) WHERE equipo_id IS NOT NULL`,
] as const;

export const dropRedundantExerciseEquipmentMigration: DatabaseMigration = {
  id: "202608190004-drop-redundant-exercise-equipment",
  description:
    "Drops the single-machine column on exercises: the catalogue already links exercises to equipment through ejercicios_equipos.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
