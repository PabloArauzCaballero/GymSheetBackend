import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { hashClientIp } from "../../common/privacy/client-ip-hash";

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

const RAW_IP_BATCH = 500;

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

  /**
   * Transitional (expand step of migration 202611180201): the coach download
   * audit still receives the raw IP from the export module. Each run replaces
   * it with its keyed hash (or drops it without a secret). Remove together
   * with the `ip` column once the export module writes `ip_hmac` itself.
   */
  async convertRawDownloadAuditIps(secret: string | undefined): Promise<number> {
    let converted = 0;
    for (;;) {
      const rows = await this.sequelize.query<{ id: string; ip: string }>(
        `SELECT id::text AS id, ip FROM training.routine_progress_download_audits
          WHERE ip IS NOT NULL LIMIT ${RAW_IP_BATCH}`,
        { type: QueryTypes.SELECT },
      );
      if (rows.length === 0) return converted;
      await this.sequelize.query(
        `UPDATE training.routine_progress_download_audits target
            SET ip_hmac = NULLIF(source.ip_hmac, ''), ip = NULL
           FROM unnest(ARRAY[:ids]::uuid[], ARRAY[:hashes]::varchar[]) AS source(id, ip_hmac)
          WHERE target.id = source.id`,
        {
          type: QueryTypes.UPDATE,
          replacements: {
            ids: rows.map((row) => row.id),
            hashes: rows.map((row) => hashClientIp(row.ip, secret) ?? ""),
          },
        },
      );
      converted += rows.length;
    }
  }
}
