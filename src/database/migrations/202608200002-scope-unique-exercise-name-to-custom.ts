import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Acota la unicidad de nombre al catálogo escrito a mano.
 *
 * La restricción anterior alcanzaba a todo ejercicio global, y eso rompía la
 * importación del catálogo externo: son 1324 registros y algunos comparten
 * nombre visible entre sí —variantes del mismo movimiento— sin que eso sea un
 * error de nadie. El conector abortaba la transacción entera y el catálogo se
 * quedaba vacío, que es peor que el problema original.
 *
 * El error estaba en confundir dos cosas que sólo se parecen:
 *
 * - que alguien del gimnasio teclee «Press de banca» tres veces, que sí es un
 *   fallo y produce filas idénticas en el selector del socio;
 * - que el catálogo de origen traiga dos registros con el mismo nombre, que no
 *   es asunto nuestro y ya tiene su propia identidad estable en
 *   `(data_source, external_id)`.
 *
 * Así que la unicidad se queda donde hace falta: los ejercicios `CUSTOM`. Los
 * importados los reconcilia el conector por su identificador de origen, no por
 * cómo se llamen.
 */
const upStatements = [
  `DROP INDEX IF EXISTS ux_ejercicios_global_nombre`,
  `CREATE UNIQUE INDEX ux_ejercicios_global_nombre
     ON ejercicios (lower(btrim(nombre)))
     WHERE created_by_usuario_id IS NULL
       AND estado = 'ACTIVO'
       AND data_source = 'CUSTOM'`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS ux_ejercicios_global_nombre`,
  `CREATE UNIQUE INDEX ux_ejercicios_global_nombre
     ON ejercicios (lower(btrim(nombre)))
     WHERE created_by_usuario_id IS NULL AND estado = 'ACTIVO'`,
] as const;

export const scopeUniqueExerciseNameToCustomMigration: DatabaseMigration = {
  id: "202608200002-scope-unique-exercise-name-to-custom",
  description:
    "Restricts the unique global exercise name to hand-written records; imported ones keep their source identity.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
