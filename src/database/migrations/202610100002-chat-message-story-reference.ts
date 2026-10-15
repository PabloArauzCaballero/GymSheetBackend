import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

export const chatMessageStoryReferenceMigration: DatabaseMigration = {
  id: "202610100002-chat-message-story-reference",
  description: "Persists story references on chat replies without coupling message retention to story retention.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages ADD COLUMN story_id uuid NULL`,
  ]),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `ALTER TABLE chat.messages DROP COLUMN story_id`,
  ]),
};
