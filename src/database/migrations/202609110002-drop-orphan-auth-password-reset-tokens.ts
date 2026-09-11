import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Retira `auth.password_reset_tokens`, que quedó huérfana al integrar dos ramas.
 *
 * Dos sesiones construyeron recuperación de contraseña por PIN a la vez, cada
 * una con su tabla. Se conservó la de `202608190001-password-reset-and-email-channel`
 * —`public.password_reset_tokens`— porque cuenta intentos, marca el consumo,
 * guarda la IP de origen y, sobre todo, entrega el código por correo de verdad.
 * La de aquí ya no tiene ni modelo ni repositorio que la lea.
 *
 * No se borra la migración que la creó (`202608230003-auth-tokens`): los ids son
 * inmutables tras el despliegue, y esa misma migración crea también
 * `auth.refresh_tokens`, que sigue en uso. Por eso la tabla se retira con una
 * migración nueva en vez de reescribiendo la vieja.
 *
 * `DROP TABLE` y no `expand/contract`: la tabla nunca llegó a producción y sus
 * filas son PINs de recuperación caducados o gastados, credenciales de vida
 * corta y sin valor histórico. No hay dato que preservar.
 */
const upStatements = [`DROP TABLE IF EXISTS auth.password_reset_tokens`] as const;

const downStatements = [
  `CREATE SCHEMA IF NOT EXISTS auth`,
  `CREATE TABLE IF NOT EXISTS auth.password_reset_tokens (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     token_hash varchar(64) NOT NULL,
     attempts smallint NOT NULL DEFAULT 0,
     expires_at timestamptz NOT NULL,
     used_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_password_reset_attempts CHECK (attempts >= 0)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_active_by_user
     ON auth.password_reset_tokens (user_id) WHERE used_at IS NULL`,
] as const;

export const dropOrphanAuthPasswordResetTokensMigration: DatabaseMigration = {
  id: "202609110002-drop-orphan-auth-password-reset-tokens",
  description:
    "Drops the orphaned auth.password_reset_tokens table left behind when the two parallel password-reset implementations were merged.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
