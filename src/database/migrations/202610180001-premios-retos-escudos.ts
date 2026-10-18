import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Premios de verdad (PLAN_RUTINAS_REPP/12, 2026-10-18).
 *
 * - `progression.prizes`: lo que el gimnasio regala de verdad («batido gratis»)
 *   atado a un hito: una insignia, un rango o una semana redonda. Es catálogo
 *   editable, con el mismo `tenant_id` nulo = «todos los gimnasios» que las
 *   insignias. `granted_count` existe para que el stock se respete con un
 *   bloqueo de fila y no contando cupones cada vez.
 * - `progression.user_prizes`: el cupón de un socio. `source_ref` es lo que hace
 *   el otorgamiento idempotente: el código de la insignia o del rango, o el
 *   lunes de la semana redonda, de modo que la misma semana no da dos cupones
 *   del mismo premio pero dos semanas redondas distintas sí.
 * - `progression.weekly_challenges`: los tres retos de la semana de cada socio.
 *   Se GUARDAN al generarse: cambiar la regla de generación no puede reescribir
 *   retos ya cumplidos ni quitar sus puntos.
 * - Escudo de los programas con modo: cuántos tiene el programa (0..1) y en qué
 *   semana se gastó.
 * - Criterios de insignia nuevos (rachas largas, retos, secretas nuevas y modo).
 *   Las filas las siembra `progression.seed.ts`.
 */
const CRITERIA_OLD = `'SESSION_COUNT','STREAK_DAYS','WEEKLY_STREAK','TOTAL_VOLUME_KG','SINGLE_SESSION_VOLUME_KG','TOTAL_SETS','TOTAL_REPS','DISTINCT_MUSCLE_GROUPS','DISTINCT_EXERCISES','EARLY_SESSIONS','NIGHT_SESSIONS','WEEKEND_SESSIONS','PERSONAL_RECORDS','OVERLOAD_WEEKS_STREAK','MODE_MULTIPLIER_MAX','STRENGTH_GOAL_REACHED','CARDIO_WEEKLY_MINUTES','TOTAL_TRAINING_MINUTES','MAX_SET_WEIGHT_KG','TIMED_SECONDS_TOTAL','CARDIO_TOTAL_MINUTES','CARDIO_TOTAL_KM','MONDAY_SESSIONS','DISTINCT_WEEKDAYS','MAX_SESSIONS_IN_WEEK','GEO_VERIFIED_SESSIONS','SUPERSET_SESSIONS','ROUTINES_CREATED','ROUTINES_PUBLISHED','ROUTINE_COPIES_RECEIVED','COMMENTS_WRITTEN','RATINGS_GIVEN','COMMENT_LIKES_RECEIVED'`;
const CRITERIA_ADDED = `'CHALLENGES_COMPLETED','PERFECT_WEEKS','COMEBACK_SESSIONS','MAX_SESSIONS_IN_DAY','LONGEST_SESSION_MINUTES','MIDNIGHT_SESSIONS','NEW_YEAR_SESSIONS','BIRTHDAY_SESSIONS','MAX_RECORDS_IN_SESSION','MODE_SHIELDS_USED','MODE_MAX_MULTIPLIER_WEEKS'`;

/** Las insignias de rachas largas usan un criterio que ya existía: se borran por código. */
const NEW_STREAK_BADGES = `'RACHA_60','RACHA_200','RACHA_365'`;

const upStatements = [
  // ------------------------------------------------------------------ premios
  `CREATE TABLE progression.prizes (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id varchar(60),
     target_kind varchar(16) NOT NULL,
     target_code varchar(60) NOT NULL,
     title varchar(80) NOT NULL,
     description varchar(300),
     instructions varchar(300),
     icon varchar(60) NOT NULL DEFAULT 'gift-outline',
     valid_days integer,
     stock integer,
     granted_count integer NOT NULL DEFAULT 0,
     active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_prize_target_kind CHECK (target_kind IN ('BADGE','LEVEL','PERFECT_WEEK')),
     CONSTRAINT ck_prize_tenant CHECK (tenant_id IS NULL OR tenant_id ~ '^[a-z0-9][a-z0-9-]*$'),
     CONSTRAINT ck_prize_valid_days CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 3650),
     CONSTRAINT ck_prize_stock CHECK (stock IS NULL OR stock >= 0),
     CONSTRAINT ck_prize_granted CHECK (granted_count >= 0)
   )`,
  // La consulta caliente es «premios activos de este hito para este gimnasio».
  `CREATE INDEX ix_prizes_target
     ON progression.prizes (target_kind, target_code) WHERE active`,

  `CREATE TABLE progression.user_prizes (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     prize_id uuid NOT NULL REFERENCES progression.prizes(id) ON DELETE CASCADE,
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     source_ref varchar(60) NOT NULL,
     code varchar(6) NOT NULL,
     status varchar(12) NOT NULL DEFAULT 'DISPONIBLE',
     awarded_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz,
     redeemed_at timestamptz,
     redeemed_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     seen boolean NOT NULL DEFAULT false,
     CONSTRAINT ck_user_prize_status CHECK (status IN ('DISPONIBLE','CANJEADO','CADUCADO')),
     -- Sin 0/O/1/I: el código se dicta en recepción y esas cuatro se confunden.
     CONSTRAINT ck_user_prize_code CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
     CONSTRAINT ck_user_prize_redeemed CHECK ((status = 'CANJEADO') = (redeemed_at IS NOT NULL)),
     CONSTRAINT uq_user_prize_source UNIQUE (prize_id, usuario_id, source_ref),
     CONSTRAINT uq_user_prize_code UNIQUE (code)
   )`,
  `CREATE INDEX ix_user_prizes_usuario
     ON progression.user_prizes (usuario_id, awarded_at DESC)`,

  // ------------------------------------------------------------------- retos
  `CREATE TABLE progression.weekly_challenges (
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     week_start date NOT NULL,
     code varchar(40) NOT NULL,
     kind varchar(24) NOT NULL,
     difficulty varchar(8) NOT NULL,
     target numeric(12,2) NOT NULL,
     points_reward integer NOT NULL,
     completed_at timestamptz,
     seen boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (usuario_id, week_start, code),
     CONSTRAINT ck_challenge_kind CHECK (kind IN ('SESSIONS','VOLUME_KG','SETS','NEW_EXERCISE','PERSONAL_RECORD','EARLY_SESSION','CARDIO_MINUTES','MUSCLE_GROUPS','GEO_SESSIONS','WEEKEND_SESSION')),
     CONSTRAINT ck_challenge_difficulty CHECK (difficulty IN ('FACIL','MEDIO','DIFICIL')),
     CONSTRAINT ck_challenge_target CHECK (target > 0),
     CONSTRAINT ck_challenge_points CHECK (points_reward >= 0),
     -- El lunes, siempre: es la clave de la semana en todo el sistema.
     CONSTRAINT ck_challenge_week_start CHECK (EXTRACT(ISODOW FROM week_start) = 1)
   )`,

  // ------------------------------------------------------------------ escudo
  `ALTER TABLE training.training_programs
     ADD COLUMN escudos smallint NOT NULL DEFAULT 0,
     ADD CONSTRAINT ck_program_escudos CHECK (escudos BETWEEN 0 AND 1)`,
  `ALTER TABLE training.program_weeks
     ADD COLUMN escudo_usado boolean NOT NULL DEFAULT false`,

  // ---------------------------------------------------------------- criterios
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_OLD},${CRITERIA_ADDED}))`,
] as const;

// Destructivo para lo que esta migración crea: cupones, retos e insignias nuevas.
const downStatements = [
  `DELETE FROM progression.badges WHERE criterion_type IN (${CRITERIA_ADDED})`,
  `DELETE FROM progression.badges WHERE tenant_id IS NULL AND code IN (${NEW_STREAK_BADGES})`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_OLD}))`,
  `ALTER TABLE training.program_weeks DROP COLUMN IF EXISTS escudo_usado`,
  `ALTER TABLE training.training_programs DROP CONSTRAINT IF EXISTS ck_program_escudos`,
  `ALTER TABLE training.training_programs DROP COLUMN IF EXISTS escudos`,
  `DROP TABLE IF EXISTS progression.weekly_challenges`,
  `DROP TABLE IF EXISTS progression.user_prizes`,
  `DROP TABLE IF EXISTS progression.prizes`,
] as const;

export const premiosRetosEscudosMigration: DatabaseMigration = {
  id: "202610180001-premios-retos-escudos",
  description:
    "Gym prizes and user coupons, personalised weekly challenges, mode shields and the new badge criteria.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
