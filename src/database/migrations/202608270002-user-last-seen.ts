import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Última vez que la cuenta tuvo un socket de chat abierto.
 *
 * Solo se escribe al desconectar el último socket activo (ver
 * `ChatPresenceService`) — mientras haya una conexión viva la persona está
 * "en línea" y esta columna no se toca; es deliberadamente el mismo criterio
 * que WhatsApp usa para "en línea" vs. "última vez".
 */
const upStatements = [
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`,
] as const;

const downStatements = [
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS last_seen_at`,
] as const;

export const userLastSeenMigration: DatabaseMigration = {
  id: "202608270002-user-last-seen",
  description:
    "Adds usuarios.last_seen_at, written when a chat presence session ends, so the chat UI can show real online/last-seen state instead of a static badge.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
