import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Apodo estilo Messenger: cada participante puede renombrar cómo ve una
 * conversación, visible solo para quien lo puso. Vive en la fila del propio
 * participante, no en la del otro ni en la conversación, porque es un dato
 * del observador, no de la relación.
 */
const upStatements = [
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS nickname varchar(60)`,
] as const;

const downStatements = [
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS nickname`,
] as const;

export const chatParticipantNicknameMigration: DatabaseMigration = {
  id: "202608270007-chat-participant-nickname",
  description: "Adds chat.participants.nickname so each participant can set a private display name for a conversation.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
