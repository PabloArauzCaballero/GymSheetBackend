import { QueryTypes } from 'sequelize';
import { DatabaseMigration } from './migration.types';

const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS training`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS data_source varchar(60) NOT NULL DEFAULT 'CUSTOM'`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS external_id varchar(180)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS external_version varchar(80)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS source_url text`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS source_license varchar(120)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS source_attribution text`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS category varchar(100)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS body_part varchar(100)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS required_equipment varchar(160)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS target_muscle varchar(120)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS synergist_muscle_group varchar(120)`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS secondary_muscles jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS instructions jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS instruction_steps jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS imported_at timestamptz`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_ejercicios_source_external_id
     ON public.ejercicios (data_source, external_id)
     WHERE external_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS ix_ejercicios_visibility
     ON public.ejercicios (estado, tipo_ejercicio, created_by_usuario_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ejercicios_training_filters
     ON public.ejercicios (body_part, target_muscle, grupo_muscular)`,
  `CREATE TABLE IF NOT EXISTS training.exercise_media (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     ejercicio_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     media_type varchar(20) NOT NULL,
     provider varchar(40) NOT NULL,
     external_id varchar(180),
     url text NOT NULL,
     thumbnail_url text,
     mime_type varchar(120),
     width integer,
     height integer,
     checksum_sha256 varchar(64),
     alt_text varchar(500) NOT NULL,
     attribution text,
     license varchar(160),
     is_primary boolean NOT NULL DEFAULT false,
     sort_order integer NOT NULL DEFAULT 0,
     status varchar(20) NOT NULL DEFAULT 'ACTIVE',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_by_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_exercise_media_dimensions CHECK (
       (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
     ),
     CONSTRAINT ck_exercise_media_checksum CHECK (
       checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-fA-F]{64}$'
     ),
     CONSTRAINT ck_exercise_media_https CHECK (url ~ '^https://')
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_media_external_identity
     ON training.exercise_media (ejercicio_id, provider, external_id)
     WHERE external_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_media_primary_active
     ON training.exercise_media (ejercicio_id)
     WHERE is_primary = true AND status = 'ACTIVE'`,
  `CREATE INDEX IF NOT EXISTS ix_exercise_media_listing
     ON training.exercise_media (ejercicio_id, status, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_active_workout_per_user
     ON public.sesiones_entrenamiento (usuario_id)
     WHERE estado = 'EN_PROGRESO'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_session_exercise_order
     ON public.sesiones_ejercicios (sesion_id, orden)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_session_exercise_identity
     ON public.sesiones_ejercicios (sesion_id, ejercicio_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_set_number
     ON public.series_entrenamiento (sesion_ejercicio_id, numero_serie)`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS public.uq_workout_set_number`,
  `DROP INDEX IF EXISTS public.uq_session_exercise_identity`,
  `DROP INDEX IF EXISTS public.uq_session_exercise_order`,
  `DROP INDEX IF EXISTS public.uq_active_workout_per_user`,
  `DROP TABLE IF EXISTS training.exercise_media`,
  `DROP INDEX IF EXISTS public.ix_ejercicios_training_filters`,
  `DROP INDEX IF EXISTS public.ix_ejercicios_visibility`,
  `DROP INDEX IF EXISTS public.uq_ejercicios_source_external_id`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS imported_at`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS metadata`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS instruction_steps`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS instructions`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS secondary_muscles`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS synergist_muscle_group`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS target_muscle`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS required_equipment`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS body_part`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS category`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS source_attribution`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS source_license`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS source_url`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS external_version`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS external_id`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS data_source`,
] as const;

async function executeStatements(
  statements: readonly string[],
  queryInterface: Parameters<DatabaseMigration['up']>[0],
  transaction: Parameters<DatabaseMigration['up']>[1],
): Promise<void> {
  for (const sqlStatement of statements) {
    await queryInterface.sequelize.query(sqlStatement, {
      type: QueryTypes.RAW,
      transaction,
    });
  }
}

export const hardeningExerciseDataMigration: DatabaseMigration = {
  id: '202607170001-hardening-exercise-data',
  description: 'Adds exercise provenance, multilingual data, media, and uniqueness guards.',
  up: (queryInterface, transaction) =>
    executeStatements(upStatements, queryInterface, transaction),
  down: (queryInterface, transaction) =>
    executeStatements(downStatements, queryInterface, transaction),
};
