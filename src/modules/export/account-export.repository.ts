import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { AccountExportSection } from "./account-export.sections";

export type AccountExportStatus = "PENDING" | "READY" | "FAILED";

export type AccountExportRow = {
  id: string;
  userId: string;
  status: AccountExportStatus;
  sizeBytes: number | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
};

const COLUMNS = `id, user_id AS "userId", status, size_bytes AS "sizeBytes", requested_at AS "requestedAt",
  completed_at AS "completedAt", expires_at AS "expiresAt"`;

/** Data access for `auth.account_exports` and the per-section reads of the archive. */
@Injectable()
export class AccountExportRepository {
  constructor(private readonly sequelize: Sequelize) {}

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /** Serializes concurrent requests of one account so the daily limit cannot be raced. */
  async lockAccount(userId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query("SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE", {
      replacements: { userId },
      transaction,
    });
  }

  async latestRequestSince(userId: string, since: Date, transaction: Transaction): Promise<Date | null> {
    const [row] = await this.sequelize.query<{ latest: Date | null }>(
      `SELECT max(requested_at) AS latest FROM auth.account_exports WHERE user_id = :userId AND requested_at > :since`,
      { type: QueryTypes.SELECT, replacements: { userId, since }, transaction },
    );
    return row?.latest ?? null;
  }

  async create(userId: string, transaction: Transaction): Promise<AccountExportRow> {
    const [row] = await this.sequelize.query<AccountExportRow>(
      `INSERT INTO auth.account_exports (user_id) VALUES (:userId) RETURNING ${COLUMNS}`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    if (!row) throw new Error("Account export row was not created.");
    return row;
  }

  /** Owner-scoped: someone else's export reads exactly like a missing one. */
  async findOwn(id: string, userId: string): Promise<AccountExportRow | null> {
    const [row] = await this.sequelize.query<AccountExportRow>(
      `SELECT ${COLUMNS} FROM auth.account_exports WHERE id = :id AND user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { id, userId } },
    );
    return row ?? null;
  }

  /** The person's most recent request, whatever its state (served by ix_account_exports_user_requested). */
  async findLatestOwn(userId: string): Promise<AccountExportRow | null> {
    const [row] = await this.sequelize.query<AccountExportRow>(
      `SELECT ${COLUMNS} FROM auth.account_exports WHERE user_id = :userId ORDER BY requested_at DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row ?? null;
  }

  async findById(id: string): Promise<AccountExportRow | null> {
    const [row] = await this.sequelize.query<AccountExportRow>(
      `SELECT ${COLUMNS} FROM auth.account_exports WHERE id = :id`,
      { type: QueryTypes.SELECT, replacements: { id } },
    );
    return row ?? null;
  }

  /** The archive as stored text, so a large export is not parsed and re-serialized. */
  async readArchive(id: string, userId: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ archive: string | null }>(
      `SELECT archive::text AS archive FROM auth.account_exports
        WHERE id = :id AND user_id = :userId AND status = 'READY' AND expires_at > now()`,
      { type: QueryTypes.SELECT, replacements: { id, userId } },
    );
    return row?.archive ?? null;
  }

  /** Own rows of one table, capped at `limit + 1` so the caller can tell it was truncated. */
  async readSection(section: AccountExportSection, userId: string, limit: number): Promise<unknown[]> {
    const omit = section.omit?.length ? ` - ARRAY[${section.omit.map((column) => `'${column}'`).join(", ")}]` : "";
    const rows = await this.sequelize.query<{ row: unknown }>(
      `SELECT to_jsonb(t)${omit} AS row FROM ${section.table} t WHERE ${section.where} LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { userId, limit: limit + 1 } },
    );
    return rows.map((entry) => entry.row);
  }

  /** True only for the call that moved the export out of PENDING: the caller notifies once. */
  async markReady(id: string, archive: string, expiresAt: Date, transaction: Transaction): Promise<boolean> {
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE auth.account_exports
          SET status = 'READY', archive = CAST(:archive AS jsonb), size_bytes = :sizeBytes,
              completed_at = now(), expires_at = :expiresAt, failure_code = NULL
        WHERE id = :id AND status = 'PENDING'
      RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { id, archive, sizeBytes: Buffer.byteLength(archive), expiresAt }, transaction },
    );
    return rows.length > 0;
  }

  /** True only for the call that moved the export out of PENDING. */
  async markFailed(id: string, failureCode: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE auth.account_exports SET status = 'FAILED', failure_code = :failureCode, completed_at = now()
        WHERE id = :id AND status = 'PENDING'
      RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { id, failureCode: failureCode.slice(0, 60) }, transaction },
    );
    return rows.length > 0;
  }

  /** An archive is personal data too: it is dropped once its link expires. */
  async purgeExpired(): Promise<number> {
    const rows = await this.sequelize.query<{ id: string }>(
      `DELETE FROM auth.account_exports WHERE expires_at IS NOT NULL AND expires_at <= now() RETURNING id`,
      { type: QueryTypes.SELECT },
    );
    return rows.length;
  }
}
