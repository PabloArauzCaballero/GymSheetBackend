import { HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DomainException } from "../../common/errors/domain.exception";
import { OutboxService } from "../integration/outbox.service";
import { AccountExportRepository, AccountExportRow } from "./account-export.repository";
import { ACCOUNT_EXPORT_SECTIONS } from "./account-export.sections";
import { MAX_ROUTINE_PROGRESS_ROWS } from "./export.service";

export const ACCOUNT_EXPORT_QUEUE = "account.export";
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a ready archive can be downloaded before it is purged. */
export const ACCOUNT_EXPORT_TTL_DAYS = 7;
/**
 * Per-table cap, the same one the routine-progress export applies to a
 * synchronous file. Above it the section says `truncated: true` instead of
 * holding an unbounded table in memory.
 */
export const ACCOUNT_EXPORT_ROWS_PER_TABLE = MAX_ROUTINE_PROGRESS_ROWS;

export type AccountExportStatusResponse = {
  id: string;
  status: AccountExportRow["status"];
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  sizeBytes: number | null;
  /** Relative to the API prefix; present only while the archive can be downloaded. */
  downloadPath: string | null;
};

/**
 * Full export of the account (right of access and portability). The request
 * only records the job; the archive is built off-request by the account-data
 * worker through the outbox, then downloaded by its owner.
 */
@Injectable()
export class AccountExportService {
  private readonly logger = new Logger(AccountExportService.name);

  constructor(
    private readonly repository: AccountExportRepository,
    private readonly outbox: OutboxService,
  ) {}

  async request(userId: string): Promise<AccountExportStatusResponse> {
    const row = await this.repository.runInTransaction(async (transaction) => {
      await this.repository.lockAccount(userId, transaction);
      const latest = await this.repository.latestRequestSince(userId, new Date(Date.now() - DAY_MS), transaction);
      if (latest) {
        throw new DomainException(
          HttpStatus.TOO_MANY_REQUESTS,
          "ACCOUNT_EXPORT_RATE_LIMITED",
          "Ya pediste una copia de tus datos hoy. Puedes pedir otra en 24 horas.",
          { retryAfterSeconds: Math.max(1, Math.ceil((new Date(latest).getTime() + DAY_MS - Date.now()) / 1000)) },
        );
      }
      const created = await this.repository.create(userId, transaction);
      await this.outbox.enqueue(
        {
          queueName: ACCOUNT_EXPORT_QUEUE,
          eventType: "account.export.v1",
          aggregateType: "account.export",
          aggregateId: created.id,
          deduplicationKey: `account-export:${created.id}`,
          payload: { exportId: created.id },
        },
        transaction,
      );
      return created;
    });
    return toStatus(row);
  }

  async status(userId: string, exportId: string): Promise<AccountExportStatusResponse> {
    const row = await this.repository.findOwn(exportId, userId);
    if (!row) throw exportNotFound();
    return toStatus(row);
  }

  /** The latest request, so a client that lost its id (reload, other device) resumes it; null when none. */
  async latest(userId: string): Promise<{ export: AccountExportStatusResponse | null }> {
    const row = await this.repository.findLatestOwn(userId);
    return { export: row ? toStatus(row) : null };
  }

  /** The stored JSON, for its owner only, while it has not expired. */
  async download(userId: string, exportId: string): Promise<string> {
    const row = await this.repository.findOwn(exportId, userId);
    if (!row) throw exportNotFound();
    const archive = await this.repository.readArchive(exportId, userId);
    if (!archive) {
      throw new DomainException(HttpStatus.CONFLICT, "ACCOUNT_EXPORT_NOT_READY", "Tu copia todavía no está lista.");
    }
    return archive;
  }

  /** Worker side: builds and stores the archive of one export job. */
  async build(exportId: string): Promise<void> {
    const row = await this.repository.findById(exportId);
    if (!row || row.status !== "PENDING") return;
    const tables: Record<string, { label: string; rows: unknown[]; truncated: boolean }> = {};
    for (const section of ACCOUNT_EXPORT_SECTIONS) {
      const rows = await this.repository.readSection(section, row.userId, ACCOUNT_EXPORT_ROWS_PER_TABLE);
      const truncated = rows.length > ACCOUNT_EXPORT_ROWS_PER_TABLE;
      tables[section.table] = { label: section.label, rows: truncated ? rows.slice(0, -1) : rows, truncated };
    }
    const archive = JSON.stringify({
      format: "gymsheet.account-export",
      version: 1,
      generatedAt: new Date().toISOString(),
      userId: row.userId,
      tables,
    });
    await this.repository.markReady(exportId, archive, new Date(Date.now() + ACCOUNT_EXPORT_TTL_DAYS * DAY_MS));
    this.logger.log({ event: "account_export.ready", exportId, sizeBytes: Buffer.byteLength(archive) });
  }

  markFailed(exportId: string, failureCode: string): Promise<void> {
    return this.repository.markFailed(exportId, failureCode);
  }

  purgeExpired(): Promise<number> {
    return this.repository.purgeExpired();
  }
}

function exportNotFound(): NotFoundException {
  return new NotFoundException("Exportación no encontrada.");
}

function toStatus(row: AccountExportRow): AccountExportStatusResponse {
  const downloadable = row.status === "READY" && row.expiresAt !== null && new Date(row.expiresAt).getTime() > Date.now();
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    sizeBytes: row.sizeBytes,
    downloadPath: downloadable ? `/me/export/${row.id}/download` : null,
  };
}
