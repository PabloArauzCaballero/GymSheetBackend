import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Evidence hold for the uploads to a personal exercise (ADR-0017 §7).
 *
 * A member deleting an upload of their personal exercise (or the exercise)
 * while a report on that exercise is open does not destroy it: the row gets
 * `author_deleted_at`, turns INACTIVE (every reader serves ACTIVE rows only)
 * and keeps its file as evidence, like profile photos and stories
 * (`202611190101-author-deleted-evidence-hold`). The reported-content
 * retention erases it, file included, 180 days after the last report closed.
 *
 * The partial index keeps the retention's scan to the held rows.
 *
 * Rollback drops the column and index. Held rows stay INACTIVE but lose the
 * marker, so the retention would no longer purge them; apply only before any
 * row is held, or re-run up.
 */
const upStatements = [
  `ALTER TABLE training.exercise_media ADD COLUMN author_deleted_at timestamptz NULL`,
  `CREATE INDEX ix_exercise_media_author_deleted ON training.exercise_media (author_deleted_at) WHERE author_deleted_at IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS training.ix_exercise_media_author_deleted`,
  `ALTER TABLE training.exercise_media DROP COLUMN IF EXISTS author_deleted_at`,
] as const;

export const exerciseMediaEvidenceHoldMigration: DatabaseMigration = {
  id: "202611190201-exercise-media-evidence-hold",
  description: "Marks personal exercise uploads their author deleted while a report on the exercise was open (evidence hold).",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
