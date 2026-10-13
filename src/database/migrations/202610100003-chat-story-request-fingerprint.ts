import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

export const chatStoryRequestFingerprintMigration: DatabaseMigration = {
  id: "202610100003-chat-story-request-fingerprint",
  description: "Accepts the versioned idempotency digest that includes story references.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages DROP CONSTRAINT ck_chat_deleted_request_hash`,
    `ALTER TABLE chat.messages ADD CONSTRAINT ck_chat_deleted_request_hash
       CHECK (deleted_request_hash IS NULL OR deleted_request_hash ~ '^v[12]:[0-9a-f]{64}$')`,
  ]),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages DROP CONSTRAINT ck_chat_deleted_request_hash`,
    `ALTER TABLE chat.messages ADD CONSTRAINT ck_chat_deleted_request_hash
       CHECK (deleted_request_hash IS NULL OR deleted_request_hash ~ '^v1:[0-9a-f]{64}$')`,
  ]),
};
