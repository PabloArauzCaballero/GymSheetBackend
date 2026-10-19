import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE social.reels
     ADD COLUMN hidden_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ADD COLUMN hidden_reason varchar(30)`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN ('STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER','ROUTINE','EXERCISE','COMMENT','REEL'))`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM moderation.reports WHERE target_kind = 'REEL') THEN
       RAISE EXCEPTION 'Cannot roll back reel moderation while reel reports exist';
     END IF;
   END
   $$`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN ('STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER','ROUTINE','EXERCISE','COMMENT'))`,
  `ALTER TABLE social.reels
     DROP COLUMN IF EXISTS hidden_reason,
     DROP COLUMN IF EXISTS hidden_by_user_id`,
] as const;

export const reelModerationMigration: DatabaseMigration = {
  id: "202610130002-reel-moderation",
  description:
    "Allows moderation reports and reversible hiding for social reels.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
