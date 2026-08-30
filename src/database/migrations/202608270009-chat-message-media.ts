import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Mensajería enriquecida: foto, video, ubicación y vista única. Los campos
 * de adjunto viven en la propia fila del mensaje (no en una tabla aparte) —
 * un mensaje tiene a lo sumo un adjunto, así que una tabla `message_media`
 * solo añadiría un join sin resolver ningún problema real.
 *
 * `body` deja de ser obligatorio: una foto o una ubicación pueden no llevar
 * texto. El CHECK existente (`ck_chat_messages_body`) ya no se dispara con
 * NULL — en Postgres una expresión CHECK que evalúa a NULL se considera
 * satisfecha — así que no hace falta tocarlo.
 */
const upStatements = [
  `ALTER TABLE chat.messages ALTER COLUMN body DROP NOT NULL`,
  `ALTER TABLE chat.messages
     ADD COLUMN IF NOT EXISTS type varchar(12) NOT NULL DEFAULT 'text'`,
  `ALTER TABLE chat.messages
     ADD CONSTRAINT ck_chat_messages_type
     CHECK (type IN ('text', 'image', 'video', 'location'))`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS media_provider varchar(20)`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS media_key text`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS media_url text`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS media_mime_type varchar(100)`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS media_size_bytes integer`,
  `ALTER TABLE chat.messages
     ADD COLUMN IF NOT EXISTS view_once boolean NOT NULL DEFAULT false`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS viewed_at timestamptz`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS location_lat double precision`,
  `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS location_lng double precision`,
] as const;

const downStatements = [
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS location_lng`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS location_lat`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS viewed_at`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS view_once`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS media_size_bytes`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS media_mime_type`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS media_url`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS media_key`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS media_provider`,
  `ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS ck_chat_messages_type`,
  `ALTER TABLE chat.messages DROP COLUMN IF EXISTS type`,
  `ALTER TABLE chat.messages ALTER COLUMN body SET NOT NULL`,
] as const;

export const chatMessageMediaMigration: DatabaseMigration = {
  id: "202608270009-chat-message-media",
  description:
    "Adds type/media/location/view-once columns to chat.messages for rich messaging (photos, video, location, view-once).",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
