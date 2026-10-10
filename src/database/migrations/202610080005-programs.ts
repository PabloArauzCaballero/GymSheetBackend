import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Programas de entrenamiento (RF-14..16): activar una rutina con un modo,
 * metas por levantamiento y cierre semanal. Un solo programa activo por
 * carril y persona lo garantiza un índice único parcial, no el código.
 *
 * `cardio_plan_id` queda sin clave foránea aquí: la tabla de planes de cardio
 * llega en la migración siguiente, que añade la restricción.
 */
const upStatements = [
  `CREATE TABLE training.training_programs (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     carril varchar(10) NOT NULL,
     modo varchar(24) NOT NULL,
     routine_id uuid REFERENCES training.routines(id),
     cardio_plan_id uuid,
     assignment_id uuid REFERENCES training.routine_assignments(id) ON DELETE SET NULL,
     config jsonb NOT NULL DEFAULT '{}'::jsonb,
     fecha_inicio date NOT NULL,
     fecha_fin_prevista date NOT NULL,
     estado varchar(10) NOT NULL DEFAULT 'ACTIVE',
     motivo_cierre varchar(16),
     cerrado_en timestamptz,
     multiplicador_actual numeric(3,2) NOT NULL DEFAULT 1.00,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_program_carril CHECK (carril IN ('STRENGTH','CARDIO')),
     CONSTRAINT ck_program_modo CHECK (modo IN ('NONE','PROGRESSIVE_OVERLOAD','STRENGTH_GOALS','CARDIO')),
     CONSTRAINT ck_program_estado CHECK (estado IN ('ACTIVE','FINISHED','STOPPED')),
     CONSTRAINT ck_program_motivo CHECK (motivo_cierre IS NULL OR motivo_cierre IN ('REPLACED','COMPLETED','USER_STOPPED','REPEATED')),
     CONSTRAINT ck_program_multiplicador CHECK (multiplicador_actual BETWEEN 1.00 AND 2.00),
     CONSTRAINT ck_program_fechas CHECK (fecha_fin_prevista >= fecha_inicio),
     CONSTRAINT ck_program_carril_modo CHECK (
       (carril = 'STRENGTH' AND routine_id IS NOT NULL AND modo <> 'CARDIO')
       OR (carril = 'CARDIO' AND modo = 'CARDIO'))
   )`,
  `CREATE UNIQUE INDEX uq_program_activo_por_carril ON training.training_programs(usuario_id, carril) WHERE estado = 'ACTIVE'`,
  `CREATE INDEX ix_program_usuario ON training.training_programs(usuario_id, estado)`,
  `CREATE INDEX ix_program_routine ON training.training_programs(routine_id) WHERE routine_id IS NOT NULL`,

  `CREATE TABLE training.program_lift_targets (
     program_id uuid NOT NULL REFERENCES training.training_programs(id) ON DELETE CASCADE,
     ejercicio_id uuid NOT NULL REFERENCES public.ejercicios(id),
     peso_trabajo_kg numeric(6,2) NOT NULL,
     reps_min smallint NOT NULL,
     reps_max smallint NOT NULL,
     rir_objetivo smallint,
     incremento_kg numeric(4,2) NOT NULL,
     peso_sugerido_kg numeric(6,2) NOT NULL,
     fallos_seguidos smallint NOT NULL DEFAULT 0,
     e1rm_inicial_kg numeric(6,2),
     e1rm_actual_kg numeric(6,2),
     marca_meta_kg numeric(6,2),
     fecha_meta date,
     alcanzada_en timestamptz,
     PRIMARY KEY (program_id, ejercicio_id),
     CONSTRAINT ck_lift_peso CHECK (peso_trabajo_kg >= 0 AND peso_sugerido_kg >= 0),
     CONSTRAINT ck_lift_reps CHECK (reps_min BETWEEN 1 AND 50 AND reps_max >= reps_min),
     CONSTRAINT ck_lift_rir CHECK (rir_objetivo IS NULL OR rir_objetivo BETWEEN 0 AND 5)
   )`,

  `CREATE TABLE training.program_weeks (
     program_id uuid NOT NULL REFERENCES training.training_programs(id) ON DELETE CASCADE,
     semana_numero smallint NOT NULL,
     semana_inicio date NOT NULL,
     es_descarga boolean NOT NULL DEFAULT false,
     sesiones_plan smallint NOT NULL,
     sesiones_hechas smallint NOT NULL DEFAULT 0,
     minutos_cardio integer NOT NULL DEFAULT 0,
     cumplida boolean,
     multiplicador numeric(3,2),
     cerrada_en timestamptz,
     PRIMARY KEY (program_id, semana_numero)
   )`,

  // Qué programa y qué día originaron la sesión (para el cierre y para RF-20).
  `ALTER TABLE public.sesiones_entrenamiento
     ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES training.training_programs(id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS routine_day_id uuid REFERENCES training.routine_days(id) ON DELETE SET NULL`,
  `CREATE INDEX ix_sesiones_program ON public.sesiones_entrenamiento(program_id) WHERE program_id IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS public.ix_sesiones_program`,
  `ALTER TABLE public.sesiones_entrenamiento DROP COLUMN IF EXISTS routine_day_id, DROP COLUMN IF EXISTS program_id`,
  `DROP TABLE IF EXISTS training.program_weeks`,
  `DROP TABLE IF EXISTS training.program_lift_targets`,
  `DROP TABLE IF EXISTS training.training_programs`,
] as const;

export const programsMigration: DatabaseMigration = {
  id: '202610080005-programs',
  description: 'Training programs with mode, lift targets, weekly rows and session linkage.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
