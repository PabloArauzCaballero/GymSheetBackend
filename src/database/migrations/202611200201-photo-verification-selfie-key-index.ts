import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Selfie files are now deleted through the shared `media.release` queue,
 * whose worker asks `MediaReferencesRepository.isReferenced` whether any row
 * still points at a key before removing it. That lookup now includes
 * `social.photo_verifications.selfie_storage_key`; this partial index keeps it
 * an index probe (only rows that still hold a selfie are indexed) instead of
 * a scan of every attempt ever made.
 *
 * Additive only. Rollback drops the index; nothing depends on it for
 * correctness.
 */
const upStatements = [
  `CREATE INDEX IF NOT EXISTS ix_photo_verifications_selfie_key
     ON social.photo_verifications (selfie_storage_key)
     WHERE selfie_storage_key IS NOT NULL`,
] as const;

const downStatements = [`DROP INDEX IF EXISTS social.ix_photo_verifications_selfie_key`] as const;

export const photoVerificationSelfieKeyIndexMigration: DatabaseMigration = {
  id: "202611200201-photo-verification-selfie-key-index",
  description: "Indexes social.photo_verifications.selfie_storage_key for the media release reference check.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
