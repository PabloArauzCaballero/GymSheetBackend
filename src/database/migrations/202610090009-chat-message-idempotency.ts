import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE chat.messages ADD COLUMN client_request_id uuid`,
  `CREATE UNIQUE INDEX ux_chat_messages_client_request
     ON chat.messages (conversation_id, sender_id, client_request_id)`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS chat.ux_chat_messages_client_request`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS client_request_id`,
] as const;

export const chatMessageIdempotencyMigration: DatabaseMigration = {
  id: "202610090009-chat-message-idempotency",
  description: "Nullable client request ID and per sender/conversation message uniqueness.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
