import { QueryInterface, QueryTypes, Transaction } from "sequelize";
import { hashClientIp } from "../../common/privacy/client-ip-hash";
import { env } from "../../config/env";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Privacy franja 4 (ADR-0014): IP minimisation, consent ledger and the hash of
 * the accepted legal text.
 *
 * 1. Raw IPs leave `public.password_reset_tokens`, `admin.audit_log` and
 *    `training.routine_progress_download_audits`. Each gets `ip_hmac`
 *    (HMAC-SHA256 keyed with `IP_HASH_SECRET`). Existing IPs are hashed with
 *    the secret configured WHEN THE MIGRATION RUNS; without a secret there is
 *    nothing to key the hash with, so they are dropped (nulled). The raw
 *    columns of the first two tables are dropped. The coach download audit
 *    keeps its `ip` column (expand step, emptied here) until the export
 *    module writes `ip_hmac`; the retention command converts any IP still
 *    written there.
 * 2. Partial indexes let retention null every `ip_hmac` older than 90 days
 *    without scanning (signup_audit already has its own).
 * 3. `auth.terms_acceptances.content_sha256`: SHA-256 of the exact text
 *    accepted. Null for acceptances recorded before this migration and for
 *    documents published without a hash.
 * 4. `auth.consents`: one row per grant, closed by `revoked_at`; at most one
 *    open row per account and kind. Consents implied by existing data are
 *    backfilled with version `LEGACY` (no text version was recorded) so the
 *    client re-asks for the current one.
 * 5. Stored map coordinates of people whose map is off are deleted: turning
 *    the map off must erase the location, not just hide it.
 *
 * Rollback drops the new objects and re-creates the raw IP columns EMPTY: a
 * keyed hash cannot be reversed, and deleted coordinates cannot come back.
 */
const BACKFILL_BATCH = 1000;

const upStatements = [
  `ALTER TABLE public.password_reset_tokens ADD COLUMN ip_hmac varchar(64) NULL`,
  `ALTER TABLE admin.audit_log ADD COLUMN ip_hmac varchar(64) NULL`,
  `ALTER TABLE training.routine_progress_download_audits ADD COLUMN ip_hmac varchar(64) NULL`,
] as const;

const contractStatements = [
  `ALTER TABLE public.password_reset_tokens DROP COLUMN solicitado_desde_ip`,
  `ALTER TABLE admin.audit_log DROP COLUMN ip`,
  `UPDATE training.routine_progress_download_audits SET ip = NULL WHERE ip IS NOT NULL`,
  `CREATE INDEX ix_terms_acceptances_ip_retention
     ON auth.terms_acceptances(accepted_at) WHERE ip_hmac IS NOT NULL`,
  `CREATE INDEX ix_user_devices_ip_retention
     ON auth.user_devices(last_seen_at) WHERE last_ip_hmac IS NOT NULL`,
  `CREATE INDEX ix_password_reset_tokens_ip_retention
     ON public.password_reset_tokens(created_at) WHERE ip_hmac IS NOT NULL`,
  `CREATE INDEX ix_admin_audit_log_ip_retention
     ON admin.audit_log(occurred_at) WHERE ip_hmac IS NOT NULL`,
  `CREATE INDEX ix_routine_progress_download_audits_ip_retention
     ON training.routine_progress_download_audits(created_at) WHERE ip_hmac IS NOT NULL`,
  `ALTER TABLE auth.terms_acceptances ADD COLUMN content_sha256 varchar(64) NULL`,
  `ALTER TABLE auth.terms_acceptances
     ADD CONSTRAINT ck_terms_acceptances_content_sha256
     CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')`,
  `CREATE TABLE auth.consents (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     kind varchar(30) NOT NULL,
     version varchar(20) NOT NULL,
     granted_at timestamptz NOT NULL DEFAULT now(),
     revoked_at timestamptz NULL,
     channel varchar(10) NOT NULL DEFAULT 'UNKNOWN',
     CONSTRAINT ck_consents_kind
       CHECK (kind IN ('HEALTH', 'ORIENTATION', 'VERIFICATION_SELFIE', 'PRECISE_LOCATION')),
     CONSTRAINT ck_consents_channel CHECK (channel IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN')),
     CONSTRAINT ck_consents_revoked_after_grant CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
   )`,
  // The gate ("is there an open consent?") is a probe on this index.
  `CREATE UNIQUE INDEX uq_consents_open_per_kind ON auth.consents(user_id, kind) WHERE revoked_at IS NULL`,
  `CREATE INDEX ix_consents_history ON auth.consents(user_id, kind, granted_at DESC)`,
  `INSERT INTO auth.consents (user_id, kind, version, granted_at)
   SELECT user_id, 'HEALTH', 'LEGACY', updated_at FROM profile.onboarding WHERE consent_health = TRUE`,
  `INSERT INTO auth.consents (user_id, kind, version, granted_at)
   SELECT user_id, 'ORIENTATION', 'LEGACY', updated_at
     FROM social.profile_details WHERE orientation IS NOT NULL`,
  `INSERT INTO auth.consents (user_id, kind, version, granted_at)
   SELECT user_id, 'PRECISE_LOCATION', 'LEGACY', COALESCE(map_enabled_since, updated_at)
     FROM social.profile_settings WHERE map_enabled = TRUE`,
  `DELETE FROM social.map_locations location
    WHERE NOT EXISTS (
      SELECT 1 FROM social.profile_settings settings
       WHERE settings.user_id = location.user_id
         AND settings.profile_enabled = TRUE AND settings.map_enabled = TRUE)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.consents`,
  `ALTER TABLE auth.terms_acceptances DROP CONSTRAINT IF EXISTS ck_terms_acceptances_content_sha256`,
  `ALTER TABLE auth.terms_acceptances DROP COLUMN IF EXISTS content_sha256`,
  `DROP INDEX IF EXISTS auth.ix_terms_acceptances_ip_retention`,
  `DROP INDEX IF EXISTS auth.ix_user_devices_ip_retention`,
  `ALTER TABLE public.password_reset_tokens ADD COLUMN IF NOT EXISTS solicitado_desde_ip inet`,
  `ALTER TABLE public.password_reset_tokens DROP COLUMN IF EXISTS ip_hmac`,
  `ALTER TABLE admin.audit_log ADD COLUMN IF NOT EXISTS ip inet`,
  `ALTER TABLE admin.audit_log DROP COLUMN IF EXISTS ip_hmac`,
  `ALTER TABLE training.routine_progress_download_audits DROP COLUMN IF EXISTS ip_hmac`,
] as const;

/** Raw IP sources hashed into `ip_hmac` before the raw values are dropped. */
const RAW_IP_SOURCES = [
  { table: "public.password_reset_tokens", raw: "host(solicitado_desde_ip)", column: "solicitado_desde_ip" },
  { table: "admin.audit_log", raw: "host(ip)", column: "ip" },
  { table: "training.routine_progress_download_audits", raw: "ip", column: "ip" },
] as const;

async function hashExistingIps(
  queryInterface: QueryInterface,
  transaction: Transaction,
  secret: string | undefined = env.IP_HASH_SECRET,
): Promise<void> {
  if (!secret) return;
  const sequelize = queryInterface.sequelize;
  for (const source of RAW_IP_SOURCES) {
    let lastId = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = await sequelize.query<{ id: string; ip: string }>(
        `SELECT id::text AS id, ${source.raw} AS ip FROM ${source.table}
          WHERE ${source.column} IS NOT NULL AND id > CAST(:lastId AS uuid)
          ORDER BY id LIMIT ${BACKFILL_BATCH}`,
        { type: QueryTypes.SELECT, replacements: { lastId }, transaction },
      );
      if (rows.length === 0) break;
      await sequelize.query(
        `UPDATE ${source.table} target SET ip_hmac = source.ip_hmac
           FROM unnest(ARRAY[:ids]::uuid[], ARRAY[:hashes]::varchar[]) AS source(id, ip_hmac)
          WHERE target.id = source.id`,
        {
          type: QueryTypes.UPDATE,
          transaction,
          replacements: { ids: rows.map((row) => row.id), hashes: rows.map((row) => hashClientIp(row.ip, secret)) },
        },
      );
      lastId = rows[rows.length - 1].id;
    }
  }
}

export const privacyIpHmacAndConsentsMigration: DatabaseMigration = {
  id: "202611180201-privacy-ip-hmac-and-consents",
  description:
    "Replaces stored raw IPs with keyed hashes, adds the consent ledger and the accepted legal text hash, and erases map locations of people whose map is off.",
  up: async (queryInterface, transaction) => {
    await executeSqlStatements(queryInterface, transaction, upStatements);
    await hashExistingIps(queryInterface, transaction);
    await executeSqlStatements(queryInterface, transaction, contractStatements);
  },
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
