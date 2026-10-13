import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Más variedad de insignias: categorías CARDIO, SOCIAL y CREADOR y los
 * criterios que las miden. Las filas las siembra el arranque
 * (`progression.seed.ts`); aquí solo se abren los CHECK para que quepan.
 */
const CRITERIA_OLD = `'SESSION_COUNT','STREAK_DAYS','WEEKLY_STREAK','TOTAL_VOLUME_KG','SINGLE_SESSION_VOLUME_KG','TOTAL_SETS','TOTAL_REPS','DISTINCT_MUSCLE_GROUPS','DISTINCT_EXERCISES','EARLY_SESSIONS','NIGHT_SESSIONS','WEEKEND_SESSIONS','PERSONAL_RECORDS','OVERLOAD_WEEKS_STREAK','MODE_MULTIPLIER_MAX','STRENGTH_GOAL_REACHED','CARDIO_WEEKLY_MINUTES'`;
const CRITERIA_ADDED = `'TOTAL_TRAINING_MINUTES','MAX_SET_WEIGHT_KG','TIMED_SECONDS_TOTAL','CARDIO_TOTAL_MINUTES','CARDIO_TOTAL_KM','MONDAY_SESSIONS','DISTINCT_WEEKDAYS','MAX_SESSIONS_IN_WEEK','GEO_VERIFIED_SESSIONS','SUPERSET_SESSIONS','ROUTINES_CREATED','ROUTINES_PUBLISHED','ROUTINE_COPIES_RECEIVED','COMMENTS_WRITTEN','RATINGS_GIVEN','COMMENT_LIKES_RECEIVED'`;
const CATEGORIES_OLD = `'CONSTANCIA','VOLUMEN','FUERZA','VARIEDAD','HITO','SECRETA','MODO'`;
const CATEGORIES_ADDED = `'CARDIO','SOCIAL','CREADOR'`;

const upStatements = [
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_category`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_category CHECK (category IN (${CATEGORIES_OLD},${CATEGORIES_ADDED}))`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_OLD},${CRITERIA_ADDED}))`,
] as const;

// Destructivo solo para las insignias nuevas (y, en cascada, para quien las tuviera).
const downStatements = [
  `DELETE FROM progression.badges WHERE category IN (${CATEGORIES_ADDED}) OR criterion_type IN (${CRITERIA_ADDED})`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_criterion`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_criterion CHECK (criterion_type IN (${CRITERIA_OLD}))`,
  `ALTER TABLE progression.badges DROP CONSTRAINT IF EXISTS ck_badge_category`,
  `ALTER TABLE progression.badges ADD CONSTRAINT ck_badge_category CHECK (category IN (${CATEGORIES_OLD}))`,
] as const;

export const badgesSocialCardioMigration: DatabaseMigration = {
  id: '202610130003-badges-social-cardio',
  description: 'Badge categories CARDIO/SOCIAL/CREADOR and their criteria.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
