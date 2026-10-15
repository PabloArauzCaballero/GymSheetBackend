import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

export const chatMessageIdempotencyBodyMigration: DatabaseMigration = {
  id: "202610090013-chat-message-idempotency-body",
  description: "Keeps the original idempotent request body stable after text edits.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages ADD COLUMN idempotency_body text NULL`,
    `UPDATE chat.messages SET idempotency_body = body WHERE client_request_id IS NOT NULL`,
  ]),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages DROP COLUMN idempotency_body`,
  ]),
};
