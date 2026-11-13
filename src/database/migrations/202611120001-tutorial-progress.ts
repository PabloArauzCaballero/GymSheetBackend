import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Progreso de las guías de la web (y del móvil cuando lo use): una fila por
 * persona y guía. La web ya llamaba a `/me/tutorial-progress` y, con un 404,
 * guardaba el «Omitir» solo en memoria: cada recarga volvía a abrir la guía de
 * bienvenida. Contrato en `GymSheetFrontend/apps/web/docs/tutorials.md`.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS profile.tutorial_progress (
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tutorial_id varchar(120) NOT NULL,
     status varchar(16) NOT NULL,
     version varchar(40) NOT NULL,
     current_step_id varchar(120) NULL,
     started_at timestamptz NULL,
     completed_at timestamptz NULL,
     last_interaction_at timestamptz NOT NULL DEFAULT now(),
     repeat_count integer NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, tutorial_id),
     CONSTRAINT ck_profile_tutorial_progress_status
       CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
     CONSTRAINT ck_profile_tutorial_progress_repeat_count CHECK (repeat_count >= 0)
   )`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS profile.tutorial_progress`] as const;

export const tutorialProgressMigration: DatabaseMigration = {
  id: "202611120001-tutorial-progress",
  description: "Stores per-user tutorial progress (skip/complete) so guides do not reopen.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
