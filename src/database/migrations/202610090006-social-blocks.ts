import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.user_blocks (
     blocker_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     blocked_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (blocker_id, blocked_id),
     CONSTRAINT ck_social_user_blocks_not_self CHECK (blocker_id <> blocked_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_social_user_blocks_blocked ON social.user_blocks (blocked_id, blocker_id)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.user_blocks`] as const;

export const socialBlocksMigration: DatabaseMigration = {
  id: "202610090006-social-blocks",
  description: "Persists social blocks so profiles, discovery, maps and chat can revoke access consistently.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
