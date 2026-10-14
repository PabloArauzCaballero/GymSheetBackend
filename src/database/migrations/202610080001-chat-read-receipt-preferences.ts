import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS chat.read_receipt_settings (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     enabled boolean NOT NULL DEFAULT true,
     version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
   )`,
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS read_receipts_enabled boolean`,
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS read_receipts_enabled_since timestamptz`,
  `ALTER TABLE chat.participants
     ADD COLUMN IF NOT EXISTS last_receipt_read_at timestamptz`,
  `ALTER TABLE chat.read_receipt_settings
     ADD COLUMN IF NOT EXISTS enabled_since timestamptz`,
] as const;

const downStatements = [
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS read_receipts_enabled`,
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS read_receipts_enabled_since`,
  `ALTER TABLE chat.participants DROP COLUMN IF EXISTS last_receipt_read_at`,
  `ALTER TABLE chat.read_receipt_settings DROP COLUMN IF EXISTS enabled_since`,
  `DROP TABLE IF EXISTS chat.read_receipt_settings`,
] as const;

export const chatReadReceiptPreferencesMigration: DatabaseMigration = {
  id: "202610080001-chat-read-receipt-preferences",
  description: "Adds versioned global and per-conversation read receipt preferences.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
