import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Chats de sistema fijos (soporte corporativo, admin del gimnasio): la
 * conversación es una fila real de `chat.conversations`/`chat.participants`
 * como cualquier otra — así el resto del módulo de chat (unirse, listar,
 * historial) no necesita casos especiales — pero etiquetada para fijarla
 * arriba de la lista y para bloquear la escritura del lado regular.
 */
const upStatements = [
  `ALTER TABLE chat.conversations
     ADD COLUMN IF NOT EXISTS system_kind varchar(20)`,
  `ALTER TABLE chat.conversations
     ADD CONSTRAINT ck_chat_conversations_system_kind
     CHECK (system_kind IN ('CORPORATE', 'TENANT_ADMIN'))`,
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS can_write boolean NOT NULL DEFAULT true`,
] as const;

const downStatements = [
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS can_write`,
  `ALTER TABLE chat.conversations DROP CONSTRAINT IF EXISTS ck_chat_conversations_system_kind`,
  `ALTER TABLE chat.conversations DROP COLUMN IF EXISTS system_kind`,
] as const;

export const chatSystemConversationsMigration: DatabaseMigration = {
  id: "202608270006-chat-system-conversations",
  description:
    "Adds chat.conversations.system_kind and chat.participants.can_write to support pinned, read-only system conversations (corporate support, tenant admin).",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
