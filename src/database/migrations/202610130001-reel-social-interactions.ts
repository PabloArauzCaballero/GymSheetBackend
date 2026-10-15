import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE social.reels
     ADD COLUMN comments_enabled boolean NOT NULL DEFAULT true`,
  `CREATE TABLE social.reel_saves (
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     reel_id uuid NOT NULL REFERENCES social.reels(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, reel_id)
   )`,
  `CREATE INDEX ix_social_reel_saves_user_created
     ON social.reel_saves (user_id, created_at DESC, reel_id)`,
  `CREATE TABLE social.reel_reposts (
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     reel_id uuid NOT NULL REFERENCES social.reels(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, reel_id)
   )`,
  `CREATE INDEX ix_social_reel_reposts_reel_created
     ON social.reel_reposts (reel_id, created_at DESC, user_id)`,
  `CREATE TABLE social.reel_likes (
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     reel_id uuid NOT NULL REFERENCES social.reels(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, reel_id)
   )`,
  `CREATE TABLE social.reel_comments (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     reel_id uuid NOT NULL REFERENCES social.reels(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     parent_comment_id uuid NULL REFERENCES social.reel_comments(id) ON DELETE CASCADE,
     body varchar(1000) NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
     created_at timestamptz NOT NULL DEFAULT NOW(),
     deleted_at timestamptz NULL,
     CONSTRAINT ck_social_reel_comments_not_self_reply
       CHECK (parent_comment_id IS NULL OR parent_comment_id <> id)
   )`,
  `CREATE INDEX ix_social_reel_comments_reel_created
     ON social.reel_comments (reel_id, created_at, id)
     WHERE deleted_at IS NULL`,
  `CREATE OR REPLACE FUNCTION social.enforce_reel_comment_one_level()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM social.reel_comments parent
        WHERE parent.id = NEW.parent_comment_id
          AND parent.reel_id = NEW.reel_id
          AND parent.parent_comment_id IS NULL
          AND parent.deleted_at IS NULL
     ) THEN
       RAISE EXCEPTION 'Reel replies must target an active root comment on the same reel'
         USING ERRCODE = '23514';
     END IF;
     RETURN NEW;
   END
   $$`,
  `CREATE TRIGGER tr_social_reel_comments_one_level
     BEFORE INSERT OR UPDATE OF reel_id, parent_comment_id
     ON social.reel_comments
     FOR EACH ROW EXECUTE FUNCTION social.enforce_reel_comment_one_level()`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM social.reel_saves LIMIT 1)
       OR EXISTS (SELECT 1 FROM social.reel_reposts LIMIT 1)
       OR EXISTS (SELECT 1 FROM social.reel_likes LIMIT 1)
       OR EXISTS (SELECT 1 FROM social.reel_comments LIMIT 1)
     THEN
       RAISE EXCEPTION 'Cannot roll back reel interactions while user data exists';
     END IF;
   END
   $$`,
  `DROP TRIGGER IF EXISTS tr_social_reel_comments_one_level ON social.reel_comments`,
  `DROP FUNCTION IF EXISTS social.enforce_reel_comment_one_level()`,
  `DROP TABLE IF EXISTS social.reel_comments`,
  `DROP TABLE IF EXISTS social.reel_likes`,
  `DROP TABLE IF EXISTS social.reel_reposts`,
  `DROP TABLE IF EXISTS social.reel_saves`,
  `ALTER TABLE social.reels DROP COLUMN IF EXISTS comments_enabled`,
] as const;

export const reelSocialInteractionsMigration: DatabaseMigration = {
  id: "202610130001-reel-social-interactions",
  description:
    "Adds private saves, reversible reposts, likes, comments and comment moderation to reels.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
