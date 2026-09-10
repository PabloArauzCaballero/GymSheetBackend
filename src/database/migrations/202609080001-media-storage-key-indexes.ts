import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Índices que sostienen el refcount de media y la purga de stories.
 *
 * El almacenamiento nombra los ficheros por SHA-256 del contenido, así que
 * antes de borrar un binario hay que preguntar si alguna otra fila lo
 * referencia (`MediaReferencesRepository`). Esa pregunta se hace una vez por
 * borrado y por purga: sin índice por clave de almacenamiento serían escaneos
 * secuenciales de tablas que crecen con los usuarios.
 *
 * `chat.messages.media_key` va con índice parcial: la inmensa mayoría de los
 * mensajes son de texto y tienen la columna a NULL.
 *
 * `profile.stories.expires_at` es el que usa la purga para encontrar el lote;
 * el índice de feed existente es `(tenant_id, expires_at)` y no sirve porque
 * la purga es global, no por gimnasio.
 */
const upStatements = [
  `CREATE INDEX IF NOT EXISTS ix_profile_stories_storage_key
     ON profile.stories (storage_key)`,
  `CREATE INDEX IF NOT EXISTS ix_profile_stories_expires_at
     ON profile.stories (expires_at)`,
  `CREATE INDEX IF NOT EXISTS ix_profile_photos_storage_key
     ON profile.photos (storage_key)`,
  `CREATE INDEX IF NOT EXISTS ix_chat_messages_media_key
     ON chat.messages (media_key) WHERE media_key IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS chat.ix_chat_messages_media_key`,
  `DROP INDEX IF EXISTS profile.ix_profile_photos_storage_key`,
  `DROP INDEX IF EXISTS profile.ix_profile_stories_expires_at`,
  `DROP INDEX IF EXISTS profile.ix_profile_stories_storage_key`,
] as const;

export const mediaStorageKeyIndexesMigration: DatabaseMigration = {
  id: "202609080001-media-storage-key-indexes",
  description:
    "Indexes storage keys and story expiry so media reference counting and the expired-story purge stay cheap.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
