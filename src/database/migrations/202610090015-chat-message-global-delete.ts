import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

export const chatMessageGlobalDeleteMigration: DatabaseMigration = {
  id: "202610090015-chat-message-global-delete",
  description: "Marks global tombstones and retains only a digest for idempotent retries.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages ADD COLUMN deleted_at timestamptz NULL, ADD COLUMN deleted_request_hash varchar(67) NULL`,
    `ALTER TABLE chat.messages ADD CONSTRAINT ck_chat_deleted_request_hash CHECK (deleted_request_hash IS NULL OR deleted_request_hash ~ '^v1:[0-9a-f]{64}$')`,
  ]),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages DROP COLUMN deleted_request_hash, DROP COLUMN deleted_at`,
  ]),
};
