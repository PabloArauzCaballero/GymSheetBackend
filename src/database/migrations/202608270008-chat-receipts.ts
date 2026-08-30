import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Check de entregado/leído estilo WhatsApp: dos cursores por participante, no
 * una marca por mensaje. `last_delivered_at`/`last_read_at` son monótonos —
 * "hasta cuándo este participante recibió/leyó" — así que un mensaje propio
 * se muestra entregado o leído comparando su `created_at` contra el cursor
 * del OTRO participante, sin tener que tocar una fila por mensaje.
 */
const upStatements = [
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz`,
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS last_read_at timestamptz`,
] as const;

const downStatements = [
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS last_read_at`,
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS last_delivered_at`,
] as const;

export const chatReceiptsMigration: DatabaseMigration = {
  id: "202608270008-chat-receipts",
  description:
    "Adds chat.participants.last_delivered_at and last_read_at cursors to support delivered/read receipts.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
