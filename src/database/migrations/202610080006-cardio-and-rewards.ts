import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Cardio (RF-17) y recompensas de modo (RF-18).
 *
 * - `cardio_plans`: el plan del usuario (modalidad, días, minutos, intensidad).
 * - Series de cardio en `series_entrenamiento`: se relajan los NOT NULL de
 *   fuerza con un CHECK por tipo. TODA suma de kilos o repeticiones debe
 *   filtrar `tipo_serie = 'FUERZA'` (riesgo R3 del plan).
 * - `mode_reward_ledger`: libro de bonos, solo INSERT. Un cierre semanal no se
 *   paga dos veces gracias a UNIQUE (program_id, semana_numero, motivo).
 * - La categoría `MODO` y los cuatro criterios de insignia nuevos.
 */
const CRITERIA_OLD = `'SESSION_COUNT','STREAK_DAYS','WEEKLY_STREAK','TOTAL_VOLUME_KG','SINGLE_SESSION_VOLUME_KG','TOTAL_SETS','TOTAL_REPS','DISTINCT_MUSCLE_GROUPS','DISTINCT_EXERCISES','EARLY_SESSIONS','NIGHT_SESSIONS','WEEKEND_SESSIONS','PERSONAL_RECORDS'`;
const CRITERIA_NEW = `${CRITERIA_OLD},'OVERLOAD_WEEKS_STREAK','MODE_MULTIPLIER_MAX','STRENGTH_GOAL_REACHED','CARDIO_WEEKLY_MINUTES'`;
const CATEGORIES_OLD = `'CONSTANCIA','VOLUMEN','FUERZA','VARIEDAD','HITO','SECRETA'`;
const CATEGORIES_NEW = `${CATEGORIES_OLD},'MODO'`;

const upStatements = [
  `CREATE TABLE training.cardio_plans (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     nombre varchar(80) NOT NULL,
     modalidad varchar(16) NOT NULL,
     dias_semana jsonb NOT NULL,
     minutos_objetivo smallint NOT NULL,
     intensidad_tipo varchar(8) NOT NULL,
     zona_objetivo smallint,
     rpe_objetivo smallint,
     intervalos jsonb,
     fc_reposo smallint,
     fc_max smallint,
     progresion_pct_semana smallint NOT NULL DEFAULT 5,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_cardio_modalidad CHECK (modalidad IN ('CORRER','CAMINAR','BICI','REMO','ELIPTICA','ESCALADORA','NADAR','HIIT','OTRO')),
     CONSTRAINT ck_cardio_minutos CHECK (minutos_objetivo BETWEEN 5 AND 300),
     CONSTRAINT ck_cardio_intensidad CHECK (intensidad_tipo IN ('ZONA_FC','RPE')),
     CONSTRAINT ck_cardio_zona CHECK (zona_objetivo IS NULL OR zona_objetivo BETWEEN 1 AND 5),
     CONSTRAINT ck_cardio_rpe CHECK (rpe_objetivo IS NULL OR rpe_objetivo BETWEEN 1 AND 10),
     CONSTRAINT ck_cardio_fc_reposo CHECK (fc_reposo IS NULL OR fc_reposo BETWEEN 30 AND 120),
     CONSTRAINT ck_cardio_fc_max CHECK (fc_max IS NULL OR fc_max BETWEEN 120 AND 230),
     CONSTRAINT ck_cardio_progresion CHECK (progresion_pct_semana BETWEEN 0 AND 10)
   )`,
  `CREATE INDEX ix_cardio_plans_usuario ON training.cardio_plans(usuario_id)`,
  `ALTER TABLE training.training_programs
     ADD CONSTRAINT fk_program_cardio_plan FOREIGN KEY (cardio_plan_id) REFERENCES training.cardio_plans(id)`,

  `ALTER TABLE public.series_entrenamiento
     ADD COLUMN IF NOT EXISTS tipo_serie varchar(8) NOT NULL DEFAULT 'FUERZA',
     ADD COLUMN IF NOT EXISTS duracion_seg integer,
     ADD COLUMN IF NOT EXISTS distancia_m integer,
     ADD COLUMN IF NOT EXISTS fc_media smallint,
     ADD COLUMN IF NOT EXISTS rpe smallint`,
  `ALTER TABLE public.series_entrenamiento
     ALTER COLUMN repeticiones DROP NOT NULL,
     ALTER COLUMN peso_kg DROP NOT NULL,
     ALTER COLUMN rir DROP NOT NULL,
     ALTER COLUMN descanso_seg_anterior SET DEFAULT 0`,
  `ALTER TABLE public.series_entrenamiento
     ADD CONSTRAINT ck_serie_tipo CHECK (tipo_serie IN ('FUERZA','CARDIO')),
     ADD CONSTRAINT ck_serie_cardio_rangos CHECK (
       (duracion_seg IS NULL OR duracion_seg BETWEEN 1 AND 86400)
       AND (distancia_m IS NULL OR distancia_m BETWEEN 0 AND 500000)
       AND (fc_media IS NULL OR fc_media BETWEEN 30 AND 230)
       AND (rpe IS NULL OR rpe BETWEEN 1 AND 10)),
     ADD CONSTRAINT ck_serie_por_tipo CHECK (
       (tipo_serie = 'FUERZA' AND repeticiones IS NOT NULL AND peso_kg IS NOT NULL AND rir IS NOT NULL)
       OR (tipo_serie = 'CARDIO' AND duracion_seg IS NOT NULL))`,

  `CREATE TABLE training.mode_reward_ledger (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     program_id uuid NOT NULL REFERENCES training.training_programs(id),
     semana_numero smallint NOT NULL,
     multiplicador numeric(3,2) NOT NULL,
     puntos_base integer NOT NULL,
     puntos_bonus integer NOT NULL,
     motivo varchar(40) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_ledger_bonus CHECK (puntos_bonus >= 0),
     CONSTRAINT uq_ledger_cierre UNIQUE (program_id, semana_numero, motivo)
   )`,
  `CREATE INDEX ix_ledger_usuario ON training.mode_reward_ledger(usuario_id)`,
  // El libro es de solo inserción: ni UPDATE ni DELETE (salvo el borrado en cascada de la cuenta).
  `CREATE OR REPLACE FUNCTION training.ledger_append_only() RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'mode_reward_ledger es de solo inserción';
     END; $$ LANGUAGE plpgsql`,
  `CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON training.mode_reward_ledger
     FOR EACH ROW EXECUTE FUNCTION training.ledger_append_only()`,

  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_category`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_category CHECK (category IN (${CATEGORIES_NEW}))`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_NEW}))`,
] as const;

const downStatements = [
  `DELETE FROM progression.badges WHERE category = 'MODO'`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_OLD}))`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_category`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_category CHECK (category IN (${CATEGORIES_OLD}))`,
  `DROP TRIGGER IF EXISTS trg_ledger_no_update ON training.mode_reward_ledger`,
  `DROP FUNCTION IF EXISTS training.ledger_append_only()`,
  `DROP TABLE IF EXISTS training.mode_reward_ledger`,
  `DELETE FROM public.series_entrenamiento WHERE tipo_serie = 'CARDIO'`,
  `ALTER TABLE public.series_entrenamiento
     DROP CONSTRAINT IF EXISTS ck_serie_por_tipo, DROP CONSTRAINT IF EXISTS ck_serie_cardio_rangos,
     DROP CONSTRAINT IF EXISTS ck_serie_tipo`,
  `ALTER TABLE public.series_entrenamiento
     ALTER COLUMN repeticiones SET NOT NULL, ALTER COLUMN peso_kg SET NOT NULL, ALTER COLUMN rir SET NOT NULL,
     ALTER COLUMN descanso_seg_anterior DROP DEFAULT`,
  `ALTER TABLE public.series_entrenamiento
     DROP COLUMN IF EXISTS rpe, DROP COLUMN IF EXISTS fc_media, DROP COLUMN IF EXISTS distancia_m,
     DROP COLUMN IF EXISTS duracion_seg, DROP COLUMN IF EXISTS tipo_serie`,
  `ALTER TABLE training.training_programs DROP CONSTRAINT IF EXISTS fk_program_cardio_plan`,
  `DROP TABLE IF EXISTS training.cardio_plans`,
] as const;

export const cardioAndRewardsMigration: DatabaseMigration = {
  id: '202610080006-cardio-and-rewards',
  description: 'Cardio plans, cardio sets, append-only mode reward ledger and MODO badges.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
