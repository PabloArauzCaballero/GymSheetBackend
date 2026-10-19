import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `ALTER TABLE training.routines DROP CONSTRAINT ck_routine_visibility`,
  `ALTER TABLE training.routines ADD CONSTRAINT ck_routine_visibility
     CHECK (visibilidad IN ('PRIVATE','SHARED','PUBLIC','TEMPLATE'))`,
  `ALTER TABLE training.routines DROP CONSTRAINT ck_routine_goal`,
  `ALTER TABLE training.routines ADD CONSTRAINT ck_routine_goal CHECK (
     objetivo IS NULL OR objetivo IN
     ('HIPERTROFIA','FUERZA','RESISTENCIA','PERDIDA_GRASA','SALUD_GENERAL','RENDIMIENTO_DEPORTIVO','REHABILITACION'))`,
  `CREATE INDEX ix_routines_public ON training.routines(visibilidad, estado, updated_at)
     WHERE visibilidad IN ('PUBLIC','TEMPLATE')`,
  `CREATE UNIQUE INDEX uq_routine_creation_key
     ON training.routines(created_by_user_id, (metadata->>'creationKey'))
     WHERE metadata ? 'creationKey'`,
  `ALTER TABLE training.routines
     ADD COLUMN hidden_at timestamptz,
     ADD COLUMN hidden_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ADD COLUMN hidden_reason varchar(30)`,
  // `ck_moderation_report_target_kind` ya no se toca aquí: esta migración llegó
  // a `test` después de 202610080004 y 202610130002, que la dejan con todos los
  // tipos de reporte. Volver a estrecharla rompe con los reportes existentes.
  // The same lift can appear twice in a planned session, at different points.
  `DROP INDEX IF EXISTS public.uq_session_exercise_identity`,
  `ALTER TABLE public.series_entrenamiento ALTER COLUMN rir DROP NOT NULL`,
  `ALTER TABLE public.sesiones_ejercicios
     ADD COLUMN routine_exercise_id uuid REFERENCES training.routine_exercises(id) ON DELETE SET NULL,
     ADD COLUMN planned_sets integer,
     ADD COLUMN planned_reps_min integer,
     ADD COLUMN planned_reps_max integer,
     ADD COLUMN planned_weight_kg numeric(7,2),
     ADD COLUMN planned_rir integer,
     ADD COLUMN planned_rest_seconds integer`,
  `CREATE INDEX ix_session_exercises_routine_exercise
     ON public.sesiones_ejercicios(routine_exercise_id)`,
] as const;

const downStatements = [
  `DELETE FROM moderation.reports WHERE target_kind = 'ROUTINE'`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN ('STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER'))`,
  `ALTER TABLE training.routines
     DROP COLUMN IF EXISTS hidden_reason,
     DROP COLUMN IF EXISTS hidden_by_user_id,
     DROP COLUMN IF EXISTS hidden_at`,
  `DROP INDEX IF EXISTS training.uq_routine_creation_key`,
  `DROP INDEX IF EXISTS public.ix_session_exercises_routine_exercise`,
  `ALTER TABLE public.sesiones_ejercicios
     DROP COLUMN IF EXISTS planned_rest_seconds,
     DROP COLUMN IF EXISTS planned_rir,
     DROP COLUMN IF EXISTS planned_weight_kg,
     DROP COLUMN IF EXISTS planned_reps_max,
     DROP COLUMN IF EXISTS planned_reps_min,
     DROP COLUMN IF EXISTS planned_sets,
     DROP COLUMN IF EXISTS routine_exercise_id`,
  `DROP INDEX IF EXISTS training.ix_routines_public`,
  `UPDATE public.series_entrenamiento SET rir = 0 WHERE rir IS NULL`,
  `ALTER TABLE public.series_entrenamiento ALTER COLUMN rir SET NOT NULL`,
  `UPDATE training.routines SET visibilidad = 'PRIVATE' WHERE visibilidad = 'PUBLIC'`,
  `UPDATE training.routines SET objetivo = 'SALUD_GENERAL' WHERE objetivo = 'RENDIMIENTO_DEPORTIVO'`,
  `ALTER TABLE training.routines DROP CONSTRAINT ck_routine_goal`,
  `ALTER TABLE training.routines ADD CONSTRAINT ck_routine_goal CHECK (
     objetivo IS NULL OR objetivo IN
     ('HIPERTROFIA','FUERZA','RESISTENCIA','PERDIDA_GRASA','SALUD_GENERAL','REHABILITACION'))`,
  `ALTER TABLE training.routines DROP CONSTRAINT ck_routine_visibility`,
  `ALTER TABLE training.routines ADD CONSTRAINT ck_routine_visibility
     CHECK (visibilidad IN ('PRIVATE','SHARED','TEMPLATE'))`,
  // Restoring uniqueness would discard valid sessions containing two blocks
  // of one exercise, so the old index deliberately remains absent on rollback.
] as const;

export const routineWorkoutFlowMigration: DatabaseMigration = {
  id: '202610060001-routine-workout-flow',
  description: 'Public routines and complete plan snapshots on workout exercises.',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
