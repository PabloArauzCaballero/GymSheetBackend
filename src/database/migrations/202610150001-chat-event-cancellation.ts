import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE chat.conversation_events
     ADD COLUMN cancelled_at timestamptz`,
] as const;

const downStatements = [
  `ALTER TABLE chat.conversation_events DROP COLUMN cancelled_at`,
] as const;

export const chatEventCancellationMigration: DatabaseMigration = {
  id: "202610150001-chat-event-cancellation",
  description: "Records cancellation timestamps on accepted training chat events.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
