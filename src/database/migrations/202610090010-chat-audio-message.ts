import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS ck_chat_messages_type`,
  `ALTER TABLE chat.messages
     ADD CONSTRAINT ck_chat_messages_type
     CHECK (type IN ('text', 'image', 'video', 'audio', 'location'))`,
] as const;

const downStatements = [
  `ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS ck_chat_messages_type`,
  `ALTER TABLE chat.messages
     ADD CONSTRAINT ck_chat_messages_type
     CHECK (type IN ('text', 'image', 'video', 'location'))`,
] as const;

export const chatAudioMessageMigration: DatabaseMigration = {
  id: "202610090010-chat-audio-message",
  description: "Allows audio messages in chat while keeping the existing message shape.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
