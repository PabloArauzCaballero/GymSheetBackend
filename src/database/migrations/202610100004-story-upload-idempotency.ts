import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE profile.stories
     ADD COLUMN upload_request_id uuid NULL,
     ADD COLUMN upload_content_hash varchar(64) NULL,
     ADD CONSTRAINT ck_profile_stories_upload_idempotency_pair
       CHECK (
         (upload_request_id IS NULL AND upload_content_hash IS NULL)
         OR (upload_request_id IS NOT NULL AND upload_content_hash IS NOT NULL
             AND upload_content_hash ~ '^[0-9a-f]{64}$')
       )`,
  `CREATE UNIQUE INDEX uq_profile_stories_user_upload_request
     ON profile.stories (user_id, upload_request_id)
     WHERE upload_request_id IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS profile.uq_profile_stories_user_upload_request`,
  `ALTER TABLE profile.stories
     DROP CONSTRAINT IF EXISTS ck_profile_stories_upload_idempotency_pair,
     DROP COLUMN IF EXISTS upload_content_hash,
     DROP COLUMN IF EXISTS upload_request_id`,
] as const;

export const storyUploadIdempotencyMigration: DatabaseMigration = {
  id: "202610100004-story-upload-idempotency",
  description: "Persists owner-scoped story upload idempotency keys and content hashes.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
