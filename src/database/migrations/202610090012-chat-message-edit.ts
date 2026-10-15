import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

export const chatMessageEditMigration: DatabaseMigration = {
  id: "202610090012-chat-message-edit",
  description: "Persists the edit label timestamp without changing message creation time.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages ADD COLUMN edited_at timestamptz NULL`,
    `ALTER TABLE chat.messages ADD CONSTRAINT ck_chat_messages_edited_at
       CHECK (edited_at IS NULL OR (type = 'text' AND edited_at >= created_at AND edited_at <= created_at + INTERVAL '15 minutes'))`,
  ]),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages DROP CONSTRAINT ck_chat_messages_edited_at`,
    `ALTER TABLE chat.messages DROP COLUMN edited_at`,
  ]),
};
