import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * `usuarios.sessions_valid_after`: access tokens issued before this instant
 * are rejected on the next request. Revoking refresh tokens alone left an
 * already issued access token alive until it expired; the JWT strategy loads
 * the account on every request anyway, so the check costs no extra query.
 */
const upStatements = [
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz NULL`,
] as const;

const downStatements = [`ALTER TABLE public.usuarios DROP COLUMN IF EXISTS sessions_valid_after`] as const;

export const sessionsValidAfterMigration: DatabaseMigration = {
  id: "202611170301-sessions-valid-after",
  description: "Adds usuarios.sessions_valid_after so ending all sessions also invalidates issued access tokens.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
