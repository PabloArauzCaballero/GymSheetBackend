import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE chat.conversations
     ADD COLUMN revoked_at timestamptz,
     ADD COLUMN revoked_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL`,
  `CREATE INDEX ix_chat_conversations_active
     ON chat.conversations (id) WHERE revoked_at IS NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS chat.ix_chat_conversations_active`,
  `ALTER TABLE chat.conversations
     DROP COLUMN IF EXISTS revoked_by_user_id,
     DROP COLUMN IF EXISTS revoked_at`,
] as const;

export const chatRevocationMigration: DatabaseMigration = {
  id: "202610090002-chat-revocation",
  description: "Revocation tombstones for social conversations after disconnecting.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
