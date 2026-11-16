import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/**
 * Every column holding a keyed IP hash, with the timestamp that dates it.
 * A new table that stores `ip_hmac` must be added here (and gets a partial
 * index on the timestamp `WHERE <column> IS NOT NULL`).
 */
export const IP_HMAC_COLUMNS = [
  { table: "auth.signup_audit", column: "ip_hmac", datedBy: "created_at" },
  { table: "auth.terms_acceptances", column: "ip_hmac", datedBy: "accepted_at" },
  { table: "auth.user_devices", column: "last_ip_hmac", datedBy: "last_seen_at" },
  { table: "public.password_reset_tokens", column: "ip_hmac", datedBy: "created_at" },
  { table: "admin.audit_log", column: "ip_hmac", datedBy: "occurred_at" },
  { table: "training.routine_progress_download_audits", column: "ip_hmac", datedBy: "created_at" },
] as const;

export type IpHmacTable = (typeof IP_HMAC_COLUMNS)[number]["table"];

@Injectable()
export class PrivacyRetentionRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /** Nulls hashes dated before `cutoff`; the rows themselves stay. */
  async clearIpHashesBefore(cutoff: Date): Promise<Record<IpHmacTable, number>> {
    const cleared = {} as Record<IpHmacTable, number>;
    for (const { table, column, datedBy } of IP_HMAC_COLUMNS) {
      const rows = await this.sequelize.query<{ cleared: number }>(
        `WITH cleared AS (
           UPDATE ${table} SET ${column} = NULL
            WHERE ${datedBy} < :cutoff AND ${column} IS NOT NULL
           RETURNING 1)
         SELECT COUNT(*)::int AS cleared FROM cleared`,
        { type: QueryTypes.SELECT, replacements: { cutoff } },
      );
      cleared[table] = rows[0]?.cleared ?? 0;
    }
    return cleared;
  }

  /** Ban-evasion records whose last strike stopped counting (ADR-0015). */
  async deleteExpiredClosedAccountSanctions(now: Date): Promise<number> {
    const rows = await this.sequelize.query<{ deleted: number }>(
      `WITH deleted AS (
         DELETE FROM moderation.closed_account_sanctions WHERE expires_at <= :now RETURNING 1)
       SELECT COUNT(*)::int AS deleted FROM deleted`,
      { type: QueryTypes.SELECT, replacements: { now } },
    );
    return rows[0]?.deleted ?? 0;
  }
}
