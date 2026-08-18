import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Ventana de vigencia de una asignación de rutina.
 *
 * `dias_semana` ya decía *qué días* se entrena, pero no *hasta cuándo*: una
 * asignación se repetía indefinidamente y la única forma de terminarla era
 * cambiarle el estado a mano. Eso convierte "quiero probar esta rutina un mes"
 * —que es como la gente piensa un mesociclo— en una tarea administrativa.
 *
 * Dos columnas, ambas opcionales para no romper las asignaciones existentes:
 * `repite_desde` marca el arranque del ciclo y `repite_hasta` su final. Sin
 * `repite_hasta` la asignación sigue siendo indefinida, que es el comportamiento
 * actual y el correcto para un plan permanente.
 */
const upStatements = [
  `ALTER TABLE training.routine_assignments
     ADD COLUMN repite_desde date,
     ADD COLUMN repite_hasta date`,
  // El final no puede preceder al inicio. Se valida en base de datos porque una
  // ventana invertida no es un caso de negocio, es un dato corrupto.
  `ALTER TABLE training.routine_assignments
     ADD CONSTRAINT ck_routine_assignment_window
     CHECK (repite_hasta IS NULL OR repite_desde IS NULL OR repite_hasta >= repite_desde)`,
  // Buscar las asignaciones vigentes hoy es la consulta que hará el cliente en
  // cada arranque, así que se indexa por ventana.
  `CREATE INDEX ix_routine_assignments_window
     ON training.routine_assignments (cliente_user_id, repite_hasta)`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS training.ix_routine_assignments_window`,
  `ALTER TABLE training.routine_assignments
     DROP CONSTRAINT IF EXISTS ck_routine_assignment_window`,
  `ALTER TABLE training.routine_assignments
     DROP COLUMN IF EXISTS repite_hasta,
     DROP COLUMN IF EXISTS repite_desde`,
] as const;

export const routineRecurrenceWindowMigration: DatabaseMigration = {
  id: "202608170001-routine-recurrence-window",
  description:
    "Recurrence window on routine assignments: optional start and end dates so a plan can be tried for a fixed period instead of repeating forever.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
