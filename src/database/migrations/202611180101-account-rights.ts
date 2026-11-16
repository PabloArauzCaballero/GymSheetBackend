import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Account rights (franja 4): closure, full export and email change.
 *
 * 1. `usuarios.closed_at`: when the person closed the account. The row is kept
 *    (anonymized, `estado = 'INACTIVO'`) so the gym's tax and accounting rows
 *    keep a valid foreign key; the timestamp tells a self-closure apart from a
 *    moderation deactivation, which keeps the email.
 * 2. `auth.email_verification_pins.purpose` reuses the email PIN for three
 *    jobs: proving the mailbox, changing the address (`target_email` holds the
 *    new one until it is confirmed) and closing an account without a usable
 *    password. Existing rows are `VERIFY_EMAIL`.
 * 3. `auth.account_exports`: one row per export request. The JSON archive lives
 *    in the row until it expires; the request timestamps back the 1-per-24h
 *    limit. Rows cascade with the account.
 *
 * Rollback drops the export table and the new columns. Non-verification PINs
 * are deleted first: without the purpose column they would read as
 * verification codes.
 */
const upStatements = [
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL`,
  `ALTER TABLE auth.email_verification_pins
     ADD COLUMN IF NOT EXISTS purpose varchar(16) NOT NULL DEFAULT 'VERIFY_EMAIL'`,
  `ALTER TABLE auth.email_verification_pins ADD COLUMN IF NOT EXISTS target_email varchar(180) NULL`,
  `ALTER TABLE auth.email_verification_pins
     ADD CONSTRAINT ck_email_pins_purpose
     CHECK (purpose IN ('VERIFY_EMAIL', 'CHANGE_EMAIL', 'CLOSE_ACCOUNT'))`,
  `ALTER TABLE auth.email_verification_pins
     ADD CONSTRAINT ck_email_pins_target_email
     CHECK ((purpose = 'CHANGE_EMAIL') = (target_email IS NOT NULL))`,
  `DROP INDEX IF EXISTS auth.ix_email_verification_pins_user_created`,
  `CREATE INDEX ix_email_verification_pins_user_purpose_created
     ON auth.email_verification_pins (user_id, purpose, created_at DESC)`,
  `CREATE TABLE auth.account_exports (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     status varchar(10) NOT NULL DEFAULT 'PENDING',
     archive jsonb NULL,
     size_bytes integer NULL,
     failure_code varchar(60) NULL,
     requested_at timestamptz NOT NULL DEFAULT now(),
     completed_at timestamptz NULL,
     expires_at timestamptz NULL,
     CONSTRAINT ck_account_exports_status CHECK (status IN ('PENDING', 'READY', 'FAILED')),
     CONSTRAINT ck_account_exports_ready CHECK (
       (status = 'READY') = (archive IS NOT NULL AND expires_at IS NOT NULL)
     ),
     CONSTRAINT ck_account_exports_size CHECK (size_bytes IS NULL OR size_bytes >= 0)
   )`,
  `CREATE INDEX ix_account_exports_user_requested
     ON auth.account_exports (user_id, requested_at DESC)`,
  `CREATE INDEX ix_account_exports_expires
     ON auth.account_exports (expires_at) WHERE expires_at IS NOT NULL`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.account_exports`,
  `DELETE FROM auth.email_verification_pins WHERE purpose <> 'VERIFY_EMAIL'`,
  `DROP INDEX IF EXISTS auth.ix_email_verification_pins_user_purpose_created`,
  `CREATE INDEX IF NOT EXISTS ix_email_verification_pins_user_created
     ON auth.email_verification_pins (user_id, created_at DESC)`,
  `ALTER TABLE auth.email_verification_pins DROP CONSTRAINT IF EXISTS ck_email_pins_target_email`,
  `ALTER TABLE auth.email_verification_pins DROP CONSTRAINT IF EXISTS ck_email_pins_purpose`,
  `ALTER TABLE auth.email_verification_pins DROP COLUMN IF EXISTS target_email`,
  `ALTER TABLE auth.email_verification_pins DROP COLUMN IF EXISTS purpose`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS closed_at`,
] as const;

export const accountRightsMigration: DatabaseMigration = {
  id: "202611180101-account-rights",
  description:
    "Adds account closure timestamp, purpose-scoped email PINs (email change, closure) and the account export table.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
