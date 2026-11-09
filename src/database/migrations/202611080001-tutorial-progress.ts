import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Progreso del Centro de ayuda (tours interactivos de la web): una fila por
 * persona y tutorial. La web ya pedía `/me/tutorial-progress`; sin este
 * endpoint caía a una copia en memoria y el tour reaparecía en cada carga.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS profile.tutorial_progress (
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tutorial_id varchar(100) NOT NULL,
     status varchar(12) NOT NULL,
     version varchar(40) NOT NULL,
     current_step_id varchar(100),
     started_at timestamptz,
     completed_at timestamptz,
     last_interaction_at timestamptz NOT NULL DEFAULT now(),
     repeat_count integer NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, tutorial_id),
     CONSTRAINT ck_tutorial_progress_status CHECK (status IN ('IN_PROGRESS','COMPLETED','SKIPPED')),
     CONSTRAINT ck_tutorial_progress_repeat CHECK (repeat_count >= 0)
   )`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS profile.tutorial_progress`] as const;

export const tutorialProgressMigration: DatabaseMigration = {
  id: "202611080001-tutorial-progress",
  description: "Adds profile.tutorial_progress, the per-user progress of the web help-center tours.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
