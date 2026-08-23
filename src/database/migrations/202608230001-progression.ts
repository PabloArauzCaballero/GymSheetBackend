import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Progresión gamificada: la senda hacia la imagen ideal.
 *
 * Cuatro tablas con dos naturalezas distintas que conviene no mezclar:
 *
 * - `levels` y `badges` son **catálogo editable**. Los administra el gimnasio,
 *   no el código. Por eso llevan `tenant_id` (una marca puede querer sus
 *   propios rangos) y `audience` (el arquetipo que motiva a alguien depende de
 *   con qué imagen se identifica, y ese es justo el objetivo del producto).
 * - `user_badges` y `user_progress` son **resultado**: se recalculan desde los
 *   entrenamientos registrados. Nunca son la fuente de verdad de nada, salvo
 *   de la fecha en que se consiguió una insignia, que sí hay que recordar
 *   porque no se puede reconstruir si más tarde cambia el umbral.
 *
 * `tenant_id` nulo significa «vale para todos los gimnasios». Es lo que hace
 * que la progresión funcione sin importar el inquilino: el catálogo sembrado
 * es global y un gimnasio solo necesita crear filas si quiere apartarse de él.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS progression`,

  // ---------------------------------------------------------------- catálogo
  `CREATE TABLE progression.levels (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id varchar(60),
     audience varchar(12) NOT NULL DEFAULT 'ANY',
     code varchar(60) NOT NULL,
     name varchar(80) NOT NULL,
     tagline varchar(200) NOT NULL,
     description text,
     min_points integer NOT NULL,
     sort_order integer NOT NULL,
     icon varchar(60) NOT NULL DEFAULT 'flame-outline',
     color varchar(9) NOT NULL DEFAULT '#c3f400',
     active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_level_audience CHECK (audience IN ('ANY','MALE','FEMALE')),
     CONSTRAINT ck_level_min_points CHECK (min_points >= 0),
     CONSTRAINT ck_level_tenant CHECK (tenant_id IS NULL OR tenant_id ~ '^[a-z0-9][a-z0-9-]*$'),
     CONSTRAINT ck_level_color CHECK (color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$')
   )`,
  // `tenant_id` nulo no colisiona consigo mismo en un UNIQUE normal, así que un
  // catálogo global podría duplicar códigos sin que nadie lo notara. Se
  // normaliza a cadena vacía dentro del índice para que sí colisione.
  `CREATE UNIQUE INDEX uq_levels_identity
     ON progression.levels (COALESCE(tenant_id, ''), audience, code)`,
  `CREATE INDEX ix_levels_lookup
     ON progression.levels (audience, min_points) WHERE active`,

  `CREATE TABLE progression.badges (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id varchar(60),
     audience varchar(12) NOT NULL DEFAULT 'ANY',
     code varchar(60) NOT NULL,
     name varchar(80) NOT NULL,
     description varchar(300) NOT NULL,
     flavor_text varchar(300),
     category varchar(30) NOT NULL,
     rarity varchar(20) NOT NULL DEFAULT 'COMUN',
     icon varchar(60) NOT NULL DEFAULT 'ribbon-outline',
     color varchar(9) NOT NULL DEFAULT '#c3f400',
     criterion_type varchar(40) NOT NULL,
     criterion_threshold numeric(12,2) NOT NULL,
     points_reward integer NOT NULL DEFAULT 0,
     secret boolean NOT NULL DEFAULT false,
     active boolean NOT NULL DEFAULT true,
     sort_order integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_badge_audience CHECK (audience IN ('ANY','MALE','FEMALE')),
     CONSTRAINT ck_badge_rarity CHECK (rarity IN ('COMUN','RARA','EPICA','LEGENDARIA')),
     CONSTRAINT ck_badge_category CHECK (category IN ('CONSTANCIA','VOLUMEN','FUERZA','VARIEDAD','HITO','SECRETA')),
     CONSTRAINT ck_badge_threshold CHECK (criterion_threshold > 0),
     CONSTRAINT ck_badge_points CHECK (points_reward >= 0),
     CONSTRAINT ck_badge_tenant CHECK (tenant_id IS NULL OR tenant_id ~ '^[a-z0-9][a-z0-9-]*$'),
     CONSTRAINT ck_badge_color CHECK (color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'),
     CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (
       'SESSION_COUNT','STREAK_DAYS','WEEKLY_STREAK','TOTAL_VOLUME_KG',
       'SINGLE_SESSION_VOLUME_KG','TOTAL_SETS','TOTAL_REPS',
       'DISTINCT_MUSCLE_GROUPS','DISTINCT_EXERCISES','EARLY_SESSIONS',
       'NIGHT_SESSIONS','WEEKEND_SESSIONS','PERSONAL_RECORDS'
     ))
   )`,
  `CREATE UNIQUE INDEX uq_badges_identity
     ON progression.badges (COALESCE(tenant_id, ''), audience, code)`,
  `CREATE INDEX ix_badges_lookup
     ON progression.badges (audience, sort_order) WHERE active`,

  // ---------------------------------------------------------------- resultado
  `CREATE TABLE progression.user_badges (
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     badge_id uuid NOT NULL REFERENCES progression.badges(id) ON DELETE CASCADE,
     awarded_at timestamptz NOT NULL DEFAULT now(),
     progress_value numeric(12,2) NOT NULL DEFAULT 0,
     seen boolean NOT NULL DEFAULT false,
     PRIMARY KEY (usuario_id, badge_id)
   )`,
  // El listado de la pantalla pide «lo último conseguido» y «lo que aún no ha
  // visto»; ambas consultas se resuelven con este índice.
  `CREATE INDEX ix_user_badges_recent
     ON progression.user_badges (usuario_id, awarded_at DESC)`,

  `CREATE TABLE progression.user_progress (
     usuario_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     points integer NOT NULL DEFAULT 0,
     level_code varchar(60),
     current_streak_days integer NOT NULL DEFAULT 0,
     longest_streak_days integer NOT NULL DEFAULT 0,
     last_session_on date,
     total_sessions integer NOT NULL DEFAULT 0,
     total_sets integer NOT NULL DEFAULT 0,
     total_volume_kg numeric(14,2) NOT NULL DEFAULT 0,
     recomputed_at timestamptz NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_user_progress_points CHECK (points >= 0),
     CONSTRAINT ck_user_progress_streaks CHECK (
       current_streak_days >= 0 AND longest_streak_days >= current_streak_days
     )
   )`,
  // Tabla de clasificación del gimnasio: el orden por puntos es la consulta.
  `CREATE INDEX ix_user_progress_ranking ON progression.user_progress (points DESC)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS progression.user_progress`,
  `DROP TABLE IF EXISTS progression.user_badges`,
  `DROP TABLE IF EXISTS progression.badges`,
  `DROP TABLE IF EXISTS progression.levels`,
  `DROP SCHEMA IF EXISTS progression`,
] as const;

export const progressionMigration: DatabaseMigration = {
  id: "202608230001-progression",
  description:
    "Gamified progression: admin-editable level and badge catalogues (per tenant and audience) plus per-user awards and progress snapshot.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
