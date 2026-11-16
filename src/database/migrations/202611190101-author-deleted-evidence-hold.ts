import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Evidence hold for content its author deletes while a report on it is open.
 *
 * A profile photo or a story deleted by its author under an OPEN report is not
 * destroyed: it gets `author_deleted_at` (and `hidden_at`, so every reader
 * that already skips hidden content stops serving it) and keeps its row and
 * file as evidence. Once every report on it is closed it follows the existing
 * erasure: photos through the reported-content retention (180 days after the
 * last report closed), stories through the stories purge. Community comments
 * need no column: `estado = 'BORRADO_AUTOR'` already hides them, and a held
 * one simply keeps its text and attachment until that same retention.
 *
 * The partial indexes keep the retention's scan to the held rows.
 *
 * Rollback drops the columns and indexes. Held rows stay hidden (`hidden_at`
 * is kept) but lose the marker, so a moderator's "restore" could show them
 * again and the retention would no longer purge them; apply only before any
 * row is held, or re-run up.
 */
const upStatements = [
  `ALTER TABLE profile.photos ADD COLUMN author_deleted_at timestamptz NULL`,
  `ALTER TABLE profile.stories ADD COLUMN author_deleted_at timestamptz NULL`,
  `CREATE INDEX ix_profile_photos_author_deleted ON profile.photos (author_deleted_at) WHERE author_deleted_at IS NOT NULL`,
  `CREATE INDEX ix_profile_stories_author_deleted ON profile.stories (author_deleted_at) WHERE author_deleted_at IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS profile.ix_profile_stories_author_deleted`,
  `DROP INDEX IF EXISTS profile.ix_profile_photos_author_deleted`,
  `ALTER TABLE profile.stories DROP COLUMN IF EXISTS author_deleted_at`,
  `ALTER TABLE profile.photos DROP COLUMN IF EXISTS author_deleted_at`,
] as const;

export const authorDeletedEvidenceHoldMigration: DatabaseMigration = {
  id: "202611190101-author-deleted-evidence-hold",
  description: "Marks profile photos and stories their author deleted while a report on them was open (evidence hold).",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
