import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

export const chatMessageLocalVisibilityMigration: DatabaseMigration = {
  id: "202610090014-chat-message-local-visibility",
  description: "Persists message hiding independently for each participant.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `CREATE TABLE chat.message_visibility (
       message_id uuid NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
       user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
       hidden_at timestamptz NOT NULL DEFAULT NOW(),
       PRIMARY KEY (message_id, user_id)
     )`,
    `CREATE INDEX ix_chat_message_visibility_user ON chat.message_visibility (user_id, message_id)`,
  ]),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, [
    `DROP TABLE chat.message_visibility`,
  ]),
};
