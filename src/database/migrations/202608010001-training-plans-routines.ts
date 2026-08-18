import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS training`,
  `CREATE TABLE training.routines (
     id uuid PRIMARY KEY,
     nombre varchar(160) NOT NULL,
     descripcion text,
     created_by_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     visibilidad varchar(20) NOT NULL DEFAULT 'PRIVATE',
     objetivo varchar(30),
     estado varchar(20) NOT NULL DEFAULT 'ACTIVE',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_routine_visibility CHECK (visibilidad IN ('PRIVATE','SHARED','TEMPLATE')),
     CONSTRAINT ck_routine_status CHECK (estado IN ('ACTIVE','ARCHIVED')),
     CONSTRAINT ck_routine_goal CHECK (
       objetivo IS NULL OR objetivo IN
       ('HIPERTROFIA','FUERZA','RESISTENCIA','PERDIDA_GRASA','SALUD_GENERAL','REHABILITACION')
     )
   )`,
  `CREATE INDEX ix_routines_created_by ON training.routines(created_by_user_id, estado)`,
  `CREATE INDEX ix_routines_visibility ON training.routines(visibilidad) WHERE visibilidad = 'TEMPLATE'`,
  `CREATE TABLE training.routine_exercises (
     id uuid PRIMARY KEY,
     routine_id uuid NOT NULL REFERENCES training.routines(id) ON DELETE CASCADE,
     ejercicio_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE RESTRICT,
     orden integer NOT NULL,
     series_objetivo integer NOT NULL DEFAULT 3,
     reps_min integer,
     reps_max integer,
     peso_objetivo_kg numeric(7,2),
     rir_objetivo integer,
     descanso_seg integer,
     nota text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_routine_exercise_order UNIQUE (routine_id, orden),
     CONSTRAINT ck_routine_exercise_order CHECK (orden BETWEEN 1 AND 500),
     CONSTRAINT ck_routine_exercise_sets CHECK (series_objetivo BETWEEN 1 AND 100),
     CONSTRAINT ck_routine_exercise_reps CHECK (
       (reps_min IS NULL OR reps_min BETWEEN 1 AND 1000)
       AND (reps_max IS NULL OR reps_max BETWEEN 1 AND 1000)
       AND (reps_min IS NULL OR reps_max IS NULL OR reps_max >= reps_min)
     ),
     CONSTRAINT ck_routine_exercise_weight CHECK (peso_objetivo_kg IS NULL OR peso_objetivo_kg BETWEEN 0 AND 2000),
     CONSTRAINT ck_routine_exercise_rir CHECK (rir_objetivo IS NULL OR rir_objetivo BETWEEN 0 AND 10),
     CONSTRAINT ck_routine_exercise_rest CHECK (descanso_seg IS NULL OR descanso_seg BETWEEN 0 AND 7200)
   )`,
  `CREATE INDEX ix_routine_exercises_routine ON training.routine_exercises(routine_id, orden)`,
  `CREATE TABLE training.routine_assignments (
     id uuid PRIMARY KEY,
     routine_id uuid NOT NULL REFERENCES training.routines(id) ON DELETE CASCADE,
     cliente_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     asignado_por_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     estado varchar(20) NOT NULL DEFAULT 'ACTIVE',
     fecha_programada date,
     dias_semana jsonb NOT NULL DEFAULT '[]'::jsonb,
     nota text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_assignment_status CHECK (estado IN ('ACTIVE','COMPLETED','CANCELLED'))
   )`,
  `CREATE INDEX ix_assignments_client ON training.routine_assignments(cliente_user_id, estado)`,
  `CREATE INDEX ix_assignments_assigned_by ON training.routine_assignments(asignado_por_user_id, estado)`,
  `CREATE UNIQUE INDEX uq_assignment_active
     ON training.routine_assignments(routine_id, cliente_user_id)
     WHERE estado = 'ACTIVE'`,
  `ALTER TABLE public.sesiones_entrenamiento
     ADD COLUMN IF NOT EXISTS routine_id uuid REFERENCES training.routines(id) ON DELETE SET NULL`,
  `ALTER TABLE public.sesiones_entrenamiento
     ADD COLUMN IF NOT EXISTS routine_assignment_id uuid REFERENCES training.routine_assignments(id) ON DELETE SET NULL`,
] as const;

const downStatements = [
  `ALTER TABLE public.sesiones_entrenamiento DROP COLUMN IF EXISTS routine_assignment_id`,
  `ALTER TABLE public.sesiones_entrenamiento DROP COLUMN IF EXISTS routine_id`,
  `DROP TABLE IF EXISTS training.routine_assignments`,
  `DROP TABLE IF EXISTS training.routine_exercises`,
  `DROP TABLE IF EXISTS training.routines`,
  `DROP SCHEMA IF EXISTS training`,
] as const;

export const trainingPlansRoutinesMigration: DatabaseMigration = {
  id: '202608010001-training-plans-routines',
  description:
    'Adds the training domain: reusable routines, prescribed exercises, coach assignments with scheduling, and workout-session links.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
