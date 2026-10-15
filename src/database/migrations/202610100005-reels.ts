import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE social.reels (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tenant_id varchar(60) NOT NULL,
     storage_provider varchar(20) NOT NULL
       CONSTRAINT ck_social_reels_storage_provider
       CHECK (storage_provider IN ('local', 'minio', 'cloudinary', 's3')),
     storage_key text NOT NULL,
     mime_type varchar(40) NOT NULL
       CONSTRAINT ck_social_reels_mime_type
       CHECK (mime_type IN ('video/mp4', 'video/quicktime')),
     duration_seconds numeric(6,3) NOT NULL
       CONSTRAINT ck_social_reels_duration_seconds
       CHECK (duration_seconds > 0 AND duration_seconds <= 90),
     status varchar(12) NOT NULL DEFAULT 'READY'
       CONSTRAINT ck_social_reels_status
       CHECK (status IN ('READY', 'PROCESSING', 'FAILED')),
     created_at timestamptz NOT NULL DEFAULT NOW(),
     hidden_at timestamptz NULL,
     deleted_at timestamptz NULL
   )`,
  `CREATE INDEX ix_social_reels_owner_created
     ON social.reels (user_id, created_at DESC)`,
  `CREATE INDEX ix_social_reels_status_created
     ON social.reels (status, created_at DESC)`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM social.reels LIMIT 1) THEN
       RAISE EXCEPTION 'Cannot roll back reels migration while user media records exist';
     END IF;
   END
   $$`,
  `DROP TABLE IF EXISTS social.reels`,
] as const;

export const reelsMigration: DatabaseMigration = {
  id: "202610100005-reels",
  description:
    "Creates persisted reel records with bounded duration and processing status.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
