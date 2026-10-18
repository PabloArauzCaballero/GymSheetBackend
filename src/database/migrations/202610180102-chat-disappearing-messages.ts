import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Mensajes temporales por conversación (desactivado / 24 h / 7 días / 90 días),
 * como en WhatsApp:
 *
 * - `conversations.disappearing_seconds` es el modo vigente, compartido por los
 *   dos participantes.
 * - `messages.expires_at` se fija al enviar con el modo activo; la lectura filtra
 *   por él (desaparece para ambos al momento) y la purga borra la fila después.
 * - `conversation_timer_events` es el aviso de sistema «X activó los mensajes
 *   temporales» que se intercala en el historial.
 */
const upStatements = [
  `ALTER TABLE chat.conversations
     ADD COLUMN disappearing_seconds integer,
     ADD CONSTRAINT ck_chat_conversations_disappearing_seconds
       CHECK (disappearing_seconds IS NULL OR disappearing_seconds IN (86400, 604800, 7776000))`,
  `ALTER TABLE chat.messages ADD COLUMN expires_at timestamptz`,
  `CREATE INDEX ix_chat_messages_expires_at
     ON chat.messages (expires_at) WHERE expires_at IS NOT NULL`,
  `CREATE TABLE chat.conversation_timer_events (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     conversation_id uuid NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
     changed_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     seconds integer,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_chat_timer_events_seconds
       CHECK (seconds IS NULL OR seconds IN (86400, 604800, 7776000))
   )`,
  `CREATE INDEX ix_chat_timer_events_history
     ON chat.conversation_timer_events (conversation_id, created_at DESC, id DESC)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS chat.conversation_timer_events`,
  `DROP INDEX IF EXISTS chat.ix_chat_messages_expires_at`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS expires_at`,
  `ALTER TABLE chat.conversations
     DROP CONSTRAINT IF EXISTS ck_chat_conversations_disappearing_seconds,
     DROP COLUMN IF EXISTS disappearing_seconds`,
] as const;

export const chatDisappearingMessagesMigration: DatabaseMigration = {
  id: "202610180102-chat-disappearing-messages",
  description: "Adds per-conversation disappearing messages with expiry, timer notices and purge index.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
