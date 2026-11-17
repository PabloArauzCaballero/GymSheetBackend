import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Email verification, device registry and third-party identities (franja 3).
 *
 * 1. `usuarios.email_verified_at`: null until the person proves the mailbox
 *    (6-digit PIN or a provider that vouches for the address). Existing
 *    accounts are test data and are grandfathered as verified, so testers keep
 *    the social features they already had. `usuarios.signup_risk` keeps the
 *    anti-automation verdict of the signup (null for accounts created before).
 * 2. `auth.email_verification_pins`: same design as the password-reset PIN
 *    (bcrypt hash, short TTL, attempt counter, consumed rows are kept as fact).
 * 3. `auth.user_devices`: one row per account and random installation id
 *    (never a hardware id). The IP is stored only as a keyed hash.
 * 4. `auth.refresh_tokens.device_id` binds a session to its device, so revoking
 *    the device ends it; `DEVICE_REVOKED` joins the allowed revoke reasons.
 * 5. `auth.identities`: provider subject (Google/Apple) linked to an account.
 *
 * Rollback drops the new objects; refresh tokens revoked as `DEVICE_REVOKED`
 * are relabelled `LOGOUT` so the original check constraint can be restored.
 */
const upStatements = [
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL`,
  `UPDATE public.usuarios SET email_verified_at = COALESCE(created_at, now())
    WHERE email_verified_at IS NULL`,
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS signup_risk varchar(6) NULL`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_signup_risk
     CHECK (signup_risk IS NULL OR signup_risk IN ('LOW', 'MEDIUM', 'HIGH'))`,
  `CREATE SCHEMA IF NOT EXISTS auth`,
  `CREATE TABLE auth.email_verification_pins (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     pin_hash text NOT NULL,
     expires_at timestamptz NOT NULL,
     consumed_at timestamptz NULL,
     attempts smallint NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_email_verification_pins_attempts CHECK (attempts >= 0)
   )`,
  `CREATE INDEX ix_email_verification_pins_user_created
     ON auth.email_verification_pins (user_id, created_at DESC)`,
  `CREATE TABLE auth.user_devices (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     installation_id uuid NOT NULL,
     platform varchar(10) NOT NULL DEFAULT 'UNKNOWN',
     os_version varchar(40) NULL,
     app_version varchar(40) NULL,
     device_model varchar(80) NULL,
     user_agent varchar(400) NULL,
     first_seen_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     last_ip_hmac varchar(64) NULL,
     revoked_at timestamptz NULL,
     CONSTRAINT uq_user_devices_user_installation UNIQUE (user_id, installation_id),
     CONSTRAINT ck_user_devices_platform CHECK (platform IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN'))
   )`,
  `ALTER TABLE auth.refresh_tokens
     ADD COLUMN IF NOT EXISTS device_id uuid NULL REFERENCES auth.user_devices(id) ON DELETE SET NULL`,
  `CREATE INDEX ix_refresh_tokens_active_by_device
     ON auth.refresh_tokens (device_id) WHERE revoked_at IS NULL`,
  `ALTER TABLE auth.refresh_tokens DROP CONSTRAINT ck_refresh_token_revoked_reason`,
  `ALTER TABLE auth.refresh_tokens
     ADD CONSTRAINT ck_refresh_token_revoked_reason CHECK (
       revoked_reason IS NULL OR revoked_reason IN (
         'ROTATED','LOGOUT','REUSE_DETECTED','PASSWORD_RESET','DEVICE_REVOKED'
       )
     )`,
  `CREATE TABLE auth.identities (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     provider varchar(10) NOT NULL,
     subject varchar(255) NOT NULL,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     email varchar(180) NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_identities_provider_subject UNIQUE (provider, subject),
     CONSTRAINT ck_identities_provider CHECK (provider IN ('GOOGLE', 'APPLE'))
   )`,
  `CREATE INDEX ix_identities_user ON auth.identities (user_id)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.identities`,
  `UPDATE auth.refresh_tokens SET revoked_reason = 'LOGOUT' WHERE revoked_reason = 'DEVICE_REVOKED'`,
  `ALTER TABLE auth.refresh_tokens DROP CONSTRAINT IF EXISTS ck_refresh_token_revoked_reason`,
  `ALTER TABLE auth.refresh_tokens
     ADD CONSTRAINT ck_refresh_token_revoked_reason CHECK (
       revoked_reason IS NULL OR revoked_reason IN (
         'ROTATED','LOGOUT','REUSE_DETECTED','PASSWORD_RESET'
       )
     )`,
  `DROP INDEX IF EXISTS auth.ix_refresh_tokens_active_by_device`,
  `ALTER TABLE auth.refresh_tokens DROP COLUMN IF EXISTS device_id`,
  `DROP TABLE IF EXISTS auth.user_devices`,
  `DROP TABLE IF EXISTS auth.email_verification_pins`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_signup_risk`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS signup_risk`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS email_verified_at`,
] as const;

export const emailVerificationDevicesIdentitiesMigration: DatabaseMigration = {
  id: "202611170101-email-verification-devices-identities",
  description:
    "Adds email verification (column + PINs), signup risk, the device registry bound to refresh tokens and provider identities.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
