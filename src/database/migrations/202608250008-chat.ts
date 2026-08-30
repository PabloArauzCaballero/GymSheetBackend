import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Chat entre socios conectados.
 *
 * `participants` es una tabla propia (no dos columnas fijas en `conversations`)
 * a propósito: una conversación de dos es el único caso que existe hoy, pero
 * modelarla como N participantes es el mismo costo y no exige una migración
 * después si el chat de grupo llega. La unicidad de "una sola conversación
 * por pareja" se resuelve en el servicio, no en el esquema — no hay una forma
 * limpia de expresar "exactamente estos dos usuarios" como restricción SQL.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS chat`,
  `CREATE TABLE chat.conversations (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE chat.participants (
     conversation_id uuid NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     joined_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (conversation_id, user_id)
   )`,
  `CREATE INDEX ix_chat_participants_user ON chat.participants (user_id)`,
  `CREATE TABLE chat.messages (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     conversation_id uuid NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
     sender_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     body text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_chat_messages_body CHECK (char_length(body) BETWEEN 1 AND 4000)
   )`,
  `CREATE INDEX ix_chat_messages_conversation ON chat.messages (conversation_id, created_at)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS chat.messages`,
  `DROP TABLE IF EXISTS chat.participants`,
  `DROP TABLE IF EXISTS chat.conversations`,
  `DROP SCHEMA IF EXISTS chat`,
] as const;

export const chatMigration: DatabaseMigration = {
  id: "202608250008-chat",
  description: "Real-time chat between connected members: conversations, participants, and messages.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
