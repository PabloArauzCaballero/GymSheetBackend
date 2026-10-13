import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE social.reels
     ADD COLUMN processing_request_id uuid NULL,
     ADD COLUMN processing_content_sha256 varchar(64) NULL,
     ADD COLUMN processing_attempt_count integer NOT NULL DEFAULT 0,
     ADD CONSTRAINT ck_social_reels_processing_request_pair
       CHECK (
         (processing_request_id IS NULL AND processing_content_sha256 IS NULL)
         OR (processing_request_id IS NOT NULL
             AND processing_content_sha256 IS NOT NULL
             AND processing_content_sha256 ~ '^[0-9a-f]{64}$')
       ),
     ADD CONSTRAINT ck_social_reels_processing_attempt_count
       CHECK (processing_attempt_count >= 0)`,
  `CREATE UNIQUE INDEX uq_social_reels_owner_processing_request
     ON social.reels (user_id, processing_request_id)
     WHERE processing_request_id IS NOT NULL`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1
         FROM social.reels
        WHERE processing_request_id IS NOT NULL OR status = 'PROCESSING'
        LIMIT 1
     ) THEN
       RAISE EXCEPTION 'Cannot roll back reel upload idempotency while processing state exists';
     END IF;
   END
   $$`,
  `DROP INDEX IF EXISTS social.uq_social_reels_owner_processing_request`,
  `ALTER TABLE social.reels
     DROP CONSTRAINT IF EXISTS ck_social_reels_processing_request_pair,
     DROP CONSTRAINT IF EXISTS ck_social_reels_processing_attempt_count,
     DROP COLUMN IF EXISTS processing_request_id,
     DROP COLUMN IF EXISTS processing_content_sha256,
     DROP COLUMN IF EXISTS processing_attempt_count`,
] as const;

export const reelUploadIdempotencyMigration: DatabaseMigration = {
  id: "202610110001-reel-upload-idempotency",
  description:
    "Persists owner-scoped reel processing request identity for safe retries.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
