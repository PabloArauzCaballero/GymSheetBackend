import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE profile.stories
     ADD COLUMN audience_mode varchar(24) NOT NULL DEFAULT 'ALL_CONNECTIONS',
     ADD CONSTRAINT ck_profile_stories_audience_mode
       CHECK (audience_mode IN ('ALL_CONNECTIONS', 'SELECTED_CONNECTIONS'))`,
  `CREATE TABLE profile.story_audiences (
     story_id uuid NOT NULL REFERENCES profile.stories(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (story_id, user_id)
   )`,
  `CREATE INDEX ix_profile_story_audiences_user ON profile.story_audiences (user_id, story_id)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS profile.story_audiences`,
  `ALTER TABLE profile.stories DROP CONSTRAINT IF EXISTS ck_profile_stories_audience_mode, DROP COLUMN IF EXISTS audience_mode`,
] as const;

export const storiesSelectedAudienceMigration: DatabaseMigration = {
  id: "202610100001-stories-selected-audience",
  description: "Persists selected story recipients while keeping existing stories visible to all accepted connections.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
