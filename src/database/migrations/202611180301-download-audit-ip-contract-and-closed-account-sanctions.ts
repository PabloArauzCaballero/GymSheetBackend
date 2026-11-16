import { QueryInterface, QueryTypes, Transaction } from "sequelize";
import { hashClientIp } from "../../common/privacy/client-ip-hash";
import { env } from "../../config/env";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Contract step of 202611180201 and ban-evasion guard (ADR-0014, ADR-0015).
 *
 * 1. `training.routine_progress_download_audits.ip` goes: the export module
 *    now writes `ip_hmac` itself. Any raw IP still there (written between the
 *    expand migration and this one) is hashed with the secret configured WHEN
 *    THIS MIGRATION RUNS, or dropped without one. The audit view is rebuilt
 *    exposing `ip_hmac` instead of the raw address; nothing in the code reads it.
 * 2. `moderation.closed_account_sanctions`: when a sanctioned person closes the
 *    account, the strikes still counting and the running suspension are kept
 *    under the keyed hash of the email, so signing up again with that email
 *    inherits them. A row lives until the last strike stops counting.
 *
 * Rollback drops the sanctions table and re-creates `ip` EMPTY with the old
 * view: a keyed hash cannot be reversed.
 */
const BATCH = 500;

const auditView = (ipColumn: "ip" | "ip_hmac") => `CREATE VIEW training.v_audit_routine_progress_downloads AS
   SELECT a.id AS audit_id, a.created_at AS downloaded_at, a.user_id, u.email AS user_email,
          u.nombre_completo AS user_full_name, u.rol AS user_role, u.tenant_id, a.format, a.file_name,
          a.records_count, a.routine_id, r.nombre AS routine_name, a.filters, a.${ipColumn}, a.user_agent
     FROM training.routine_progress_download_audits a
     INNER JOIN public.usuarios u ON a.user_id = u.id
     LEFT JOIN training.routines r ON a.routine_id = r.id`;

const upStatements = [
  `DROP VIEW IF EXISTS training.v_audit_routine_progress_downloads`,
  `ALTER TABLE training.routine_progress_download_audits DROP COLUMN ip`,
  auditView("ip_hmac"),
  `CREATE TABLE moderation.closed_account_sanctions (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     email_hmac varchar(64) NOT NULL,
     suspended_until timestamptz NULL,
     strike_count integer NOT NULL,
     strikes jsonb NOT NULL DEFAULT '[]'::jsonb,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_closed_account_sanctions_email_hmac CHECK (email_hmac ~ '^[0-9a-f]{64}$'),
     CONSTRAINT ck_closed_account_sanctions_strikes
       CHECK (jsonb_typeof(strikes) = 'array' AND jsonb_array_length(strikes) = strike_count),
     CONSTRAINT ck_closed_account_sanctions_not_empty CHECK (strike_count > 0 OR suspended_until IS NOT NULL)
   )`,
  // Signup probe (email + still valid) and the retention sweep.
  `CREATE INDEX ix_closed_account_sanctions_email ON moderation.closed_account_sanctions(email_hmac, expires_at)`,
  `CREATE INDEX ix_closed_account_sanctions_expiry ON moderation.closed_account_sanctions(expires_at)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS moderation.closed_account_sanctions`,
  `DROP VIEW IF EXISTS training.v_audit_routine_progress_downloads`,
  `ALTER TABLE training.routine_progress_download_audits ADD COLUMN IF NOT EXISTS ip varchar(60) NULL`,
  auditView("ip"),
] as const;

/** Hashes the raw IPs left in the audit before the column is dropped. */
async function hashRemainingIps(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  const secret = env.IP_HASH_SECRET;
  if (!secret) return;
  const sequelize = queryInterface.sequelize;
  for (;;) {
    const rows = await sequelize.query<{ id: string; ip: string }>(
      `SELECT id::text AS id, ip FROM training.routine_progress_download_audits
        WHERE ip IS NOT NULL AND ip_hmac IS NULL LIMIT ${BATCH}`,
      { type: QueryTypes.SELECT, transaction },
    );
    if (rows.length === 0) return;
    await sequelize.query(
      `UPDATE training.routine_progress_download_audits target SET ip_hmac = source.ip_hmac, ip = NULL
         FROM unnest(ARRAY[:ids]::uuid[], ARRAY[:hashes]::varchar[]) AS source(id, ip_hmac)
        WHERE target.id = source.id`,
      {
        type: QueryTypes.UPDATE,
        transaction,
        replacements: { ids: rows.map((row) => row.id), hashes: rows.map((row) => hashClientIp(row.ip, secret)) },
      },
    );
  }
}

export const downloadAuditIpContractAndClosedAccountSanctionsMigration: DatabaseMigration = {
  id: "202611180301-download-audit-ip-contract-and-closed-account-sanctions",
  description:
    "Drops the raw IP of the coach download audit (view rebuilt on ip_hmac) and adds moderation.closed_account_sanctions against ban evasion.",
  up: async (queryInterface, transaction) => {
    await hashRemainingIps(queryInterface, transaction);
    await executeSqlStatements(queryInterface, transaction, upStatements);
  },
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
