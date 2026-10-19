import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const CRITERIA_PREV = `'SESSION_COUNT','STREAK_DAYS','WEEKLY_STREAK','TOTAL_VOLUME_KG','SINGLE_SESSION_VOLUME_KG','TOTAL_SETS','TOTAL_REPS','DISTINCT_MUSCLE_GROUPS','DISTINCT_EXERCISES','EARLY_SESSIONS','NIGHT_SESSIONS','WEEKEND_SESSIONS','PERSONAL_RECORDS','OVERLOAD_WEEKS_STREAK','MODE_MULTIPLIER_MAX','STRENGTH_GOAL_REACHED','CARDIO_WEEKLY_MINUTES','TOTAL_TRAINING_MINUTES','MAX_SET_WEIGHT_KG','TIMED_SECONDS_TOTAL','CARDIO_TOTAL_MINUTES','CARDIO_TOTAL_KM','MONDAY_SESSIONS','DISTINCT_WEEKDAYS','MAX_SESSIONS_IN_WEEK','GEO_VERIFIED_SESSIONS','SUPERSET_SESSIONS','ROUTINES_CREATED','ROUTINES_PUBLISHED','ROUTINE_COPIES_RECEIVED','COMMENTS_WRITTEN','RATINGS_GIVEN','COMMENT_LIKES_RECEIVED','CHALLENGES_COMPLETED','PERFECT_WEEKS','COMEBACK_SESSIONS','MAX_SESSIONS_IN_DAY','LONGEST_SESSION_MINUTES','MIDNIGHT_SESSIONS','NEW_YEAR_SESSIONS','BIRTHDAY_SESSIONS','MAX_RECORDS_IN_SESSION','MODE_SHIELDS_USED','MODE_MAX_MULTIPLIER_WEEKS'`;
const CRITERIA_NEW = `'GYM_SOCIAL_PARTNERS','COACH_SESSIONS','COACH_CLIENTS','COACH_CLIENTS_PRS'`;

const upStatements = [
  `CREATE TABLE IF NOT EXISTS progression.user_streak_strikes (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     mes varchar(7) NOT NULL,
     strikes_usados smallint NOT NULL DEFAULT 0,
     strikes_comprados smallint NOT NULL DEFAULT 0,
     puntos_penalizados integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_user_streak_strikes_month UNIQUE (usuario_id, mes),
     CONSTRAINT ck_strikes_usados_non_neg CHECK (strikes_usados >= 0),
     CONSTRAINT ck_strikes_comprados_non_neg CHECK (strikes_comprados >= 0),
     CONSTRAINT ck_puntos_penalizados_non_neg CHECK (puntos_penalizados >= 0)
   )`,

  `CREATE INDEX IF NOT EXISTS ix_user_streak_strikes_user_month
     ON progression.user_streak_strikes (usuario_id, mes)`,

  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_PREV},${CRITERIA_NEW}))`,
] as const;

const downStatements = [
  `DELETE FROM progression.badges WHERE criterion_type IN (${CRITERIA_NEW})`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_PREV}))`,
  `DROP TABLE IF EXISTS progression.user_streak_strikes`,
] as const;

export const progressionStrikesAndCoachCardsMigration: DatabaseMigration = {
  id: '202610190002-progression-strikes-and-coach-cards',
  description:
    'Monthly streak strikes (3 base, point exchange, missed session penalty) and badges for gym social interaction and coach achievements.',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
