import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Refresh tokens rotativos (SEC-02, requisito #2 del cliente móvil).
 *
 * Hasta ahora la API solo emitía un access token de 15 minutos: la app móvil
 * mandaba a la persona al login cada cuarto de hora. Cada fila es un refresh
 * token; `family_id` agrupa los de una misma sesión (un login), que es lo que
 * se revoca al cerrar sesión o al detectar el reuso de un token ya rotado.
 *
 * Solo se guarda el HMAC del token (`token_hash`), nunca el token: una copia
 * de la base no sirve para abrir sesiones.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS auth`,
  `CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     family_id uuid NOT NULL,
     token_hash char(64) NOT NULL,
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     replaced_by_id uuid REFERENCES auth.refresh_tokens(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash),
     CONSTRAINT ck_refresh_tokens_expiry CHECK (expires_at > created_at)
   )`,
  // Revocar una sesión entera (logout, reuso) recorre su familia.
  `CREATE INDEX IF NOT EXISTS ix_refresh_tokens_family
     ON auth.refresh_tokens (family_id) WHERE revoked_at IS NULL`,
  // Cerrar todas las sesiones de una cuenta, cuando exista, recorre sus tokens vivos.
  `CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_active
     ON auth.refresh_tokens (user_id) WHERE revoked_at IS NULL`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.refresh_tokens`,
  `DROP SCHEMA IF EXISTS auth`,
] as const;

export const authRefreshTokensMigration: DatabaseMigration = {
  id: "202611110001-auth-refresh-tokens",
  description:
    "Rotating refresh tokens (hashed) grouped by session family, so mobile sessions survive the 15-minute access token.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
