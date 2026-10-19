import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Responder citando, reacciones con emoji y reenviar, como en WhatsApp:
 *
 * - `messages.reply_to_id` apunta al mensaje citado; si la purga de temporales
 *   borra el original, la cita queda en `NULL` y la respuesta sigue viva.
 * - `messages.forwarded` marca un mensaje reenviado («Reenviado»).
 * - `message_reactions`: una reacción por persona y mensaje (cambiarla la
 *   reemplaza); se borra con el mensaje o con la cuenta.
 */
const upStatements = [
  `ALTER TABLE chat.messages
     ADD COLUMN reply_to_id uuid REFERENCES chat.messages(id) ON DELETE SET NULL,
     ADD COLUMN forwarded boolean NOT NULL DEFAULT false`,
  `CREATE INDEX ix_chat_messages_reply_to_id
     ON chat.messages (reply_to_id) WHERE reply_to_id IS NOT NULL`,
  `CREATE TABLE chat.message_reactions (
     message_id uuid NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     emoji varchar(16) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (message_id, user_id)
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS chat.message_reactions`,
  `DROP INDEX IF EXISTS chat.ix_chat_messages_reply_to_id`,
  `ALTER TABLE chat.messages
     DROP COLUMN IF EXISTS forwarded,
     DROP COLUMN IF EXISTS reply_to_id`,
] as const;

export const chatRepliesReactionsForwardMigration: DatabaseMigration = {
  id: "202610180201-chat-replies-reactions-forward",
  description: "Adds quoted replies, per-user emoji reactions and the forwarded flag to chat messages.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
