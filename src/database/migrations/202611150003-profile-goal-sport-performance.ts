import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * `perfiles_antropometricos.objetivo` was created (docs/db/schema.sql) without
 * `RENDIMIENTO_DEPORTIVO`, although the API (`TrainingGoal`) and both clients
 * offer it. Saving that goal from «Editar perfil», or completing onboarding with
 * `SPORT_PERFORMANCE`, failed with a 500 on the CHECK constraint. This aligns the
 * constraint with the enum.
 *
 * The new constraint is added `NOT VALID`: that takes the ACCESS EXCLUSIVE lock
 * only for the catalog change, without scanning the table. The scan happens in
 * `202611150004-validate-profile-goal-check`, in its own transaction, under
 * VALIDATE's weaker SHARE UPDATE EXCLUSIVE lock (reads and writes keep flowing).
 * Validating here would scan while this transaction still held ACCESS EXCLUSIVE.
 * New and updated rows are checked from the moment the constraint exists.
 */
const goals = ["HIPERTROFIA", "FUERZA", "RESISTENCIA", "PERDIDA_GRASA", "SALUD_GENERAL", "RENDIMIENTO_DEPORTIVO", "REHABILITACION"];
const previous = goals.filter((goal) => goal !== "RENDIMIENTO_DEPORTIVO");
export const PROFILE_GOAL_CHECK = "ck_perfiles_objetivo";
const check = (values: string[], notValid = "") =>
  `ALTER TABLE public.perfiles_antropometricos ADD CONSTRAINT ${PROFILE_GOAL_CHECK} CHECK (objetivo IN (${values.map((value) => `'${value}'`).join(", ")}))${notValid}`;

const upStatements = [
  `ALTER TABLE public.perfiles_antropometricos DROP CONSTRAINT IF EXISTS ck_perfiles_objetivo`,
  check(goals, " NOT VALID"),
] as const;

const downStatements = [
  // Rows saved with the new goal would violate the old constraint.
  `UPDATE public.perfiles_antropometricos SET objetivo = 'SALUD_GENERAL' WHERE objetivo = 'RENDIMIENTO_DEPORTIVO'`,
  `ALTER TABLE public.perfiles_antropometricos DROP CONSTRAINT IF EXISTS ck_perfiles_objetivo`,
  check(previous),
] as const;

export const profileGoalSportPerformanceMigration: DatabaseMigration = {
  id: "202611150003-profile-goal-sport-performance",
  description: "Allows RENDIMIENTO_DEPORTIVO in perfiles_antropometricos.objetivo, matching TrainingGoal.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
