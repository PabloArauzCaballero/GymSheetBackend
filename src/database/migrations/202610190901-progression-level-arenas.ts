import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Cada rango de la senda pasa a vivir en una **arena**: el lugar del gimnasio
 * que corresponde a esa fase («La Jaula», «El Coliseo») y los hitos que
 * suelen caer en ella («primera dominada estricta»). El rango sigue diciendo
 * quién eres; la arena dice dónde estás y qué te espera.
 *
 * Ambas columnas son opcionales para no romper los rangos que un gimnasio ya
 * creó a mano: sin arena, la app muestra el rango como hasta ahora.
 */
const upStatements = [
  `ALTER TABLE progression.levels ADD COLUMN arena varchar(80)`,
  `ALTER TABLE progression.levels ADD COLUMN milestones jsonb NOT NULL DEFAULT '[]'::jsonb`,
] as const;

const downStatements = [
  `ALTER TABLE progression.levels DROP COLUMN milestones`,
  `ALTER TABLE progression.levels DROP COLUMN arena`,
] as const;

export const progressionLevelArenasMigration: DatabaseMigration = {
  id: "202610190901-progression-level-arenas",
  description: "Adds the arena name and the phase milestones to each progression level.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
