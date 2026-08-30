import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Refresh tokens and password-reset PINs: random secrets stored only as a
 * keyed hash (never the raw value — see `token-hash.util.ts`), so a database
 * read alone never yields something a caller can present back to the API.
 *
 * `refresh_tokens.family_id` links every token born from the same login
 * through its rotation chain. Presenting an already-`revoked_at` token is a
 * reuse signal (the legitimate holder should only ever have the newest one),
 * so the auth service revokes the whole family when that happens instead of
 * just the one row.
 *
 * `password_reset_tokens.token_hash` is deliberately **not** unique: the
 * reset code shown to the user is a 6-digit PIN (matching the flow already
 * built in `apps/web`, one code per email, not a long unguessable link), so
 * two different users can land on the same digits by chance. Rows are looked
 * up by `user_id` — at most one active per user, since a fresh request
 * invalidates whatever came before it — and `attempts` caps how many wrong
 * guesses a single PIN tolerates before it must be requested again, which is
 * what keeps a 6-digit space (1,000,000 values) safe against brute force.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS auth`,

  `CREATE TABLE auth.refresh_tokens (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     family_id uuid NOT NULL,
     token_hash varchar(64) NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     revoked_reason varchar(20),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_refresh_token_revoked_reason CHECK (
       revoked_reason IS NULL OR revoked_reason IN (
         'ROTATED','LOGOUT','REUSE_DETECTED','PASSWORD_RESET'
       )
     ),
     CONSTRAINT ck_refresh_token_revoked_consistency CHECK (
       (revoked_at IS NULL) = (revoked_reason IS NULL)
     )
   )`,
  // Active-session lookups ("does this user have live refresh tokens?") only
  // ever care about unrevoked rows; the partial index keeps it small forever
  // instead of growing with the full rotation history.
  `CREATE INDEX ix_refresh_tokens_active_by_user
     ON auth.refresh_tokens (user_id) WHERE revoked_at IS NULL`,
  `CREATE INDEX ix_refresh_tokens_family ON auth.refresh_tokens (family_id)`,

  `CREATE TABLE auth.password_reset_tokens (
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
  // At most one unused row per user in practice (a new request invalidates
  // the previous one), so this partial index is both the uniqueness guard in
  // spirit and the lookup path `confirmPasswordReset` uses.
  `CREATE INDEX ix_password_reset_tokens_active_by_user
     ON auth.password_reset_tokens (user_id) WHERE used_at IS NULL`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.password_reset_tokens`,
  `DROP TABLE IF EXISTS auth.refresh_tokens`,
  `DROP SCHEMA IF EXISTS auth`,
] as const;

export const authTokensMigration: DatabaseMigration = {
  id: "202608230003-auth-tokens",
  description:
    "Hashed, revocable refresh tokens (with rotation-chain reuse detection) and single-use password-reset tokens.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
