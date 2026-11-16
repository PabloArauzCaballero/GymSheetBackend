import { HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import { OutboxService } from "../integration/outbox.service";
import { NoticeEmailService } from "../notifications/notice-email.service";
import { NotificationService } from "../notifications/notification.service";
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
    private readonly notifications: NotificationService,
    private readonly noticeEmails: NoticeEmailService,
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
    const expiresAt = new Date(Date.now() + ACCOUNT_EXPORT_TTL_DAYS * DAY_MS);
    // The state change and its notice commit together, and only the call that
    // moved the export out of PENDING notifies: a retried job says nothing twice.
    const ready = await this.repository.runInTransaction(async (transaction) => {
      const updated = await this.repository.markReady(exportId, archive, expiresAt, transaction);
      if (updated) await this.notifyOwner(row.userId, readyNotice(exportId, expiresAt), transaction);
      return updated;
    });
    if (ready) this.logger.log({ event: "account_export.ready", exportId, sizeBytes: Buffer.byteLength(archive) });
  }

  /** Dead-lettered build: the export is FAILED and its owner is told, once. */
  async markFailed(exportId: string, failureCode: string): Promise<void> {
    const row = await this.repository.findById(exportId);
    if (!row) return;
    await this.repository.runInTransaction(async (transaction) => {
      if (await this.repository.markFailed(exportId, failureCode, transaction)) {
        await this.notifyOwner(row.userId, failedNotice(exportId), transaction);
      }
    });
  }

  /** In the app, with the download path, and by email (the person may have left the screen). */
  private async notifyOwner(userId: string, notice: ExportNotice, transaction: Transaction): Promise<void> {
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: userId,
        channel: NotificationChannel.IN_APP,
        subject: notice.subject,
        body: notice.body,
        deduplicationKey: notice.key,
        metadata: notice.metadata,
      },
      transaction,
    );
    await this.noticeEmails.enqueue(
      { recipientUserId: userId, subject: notice.subject, body: notice.body, deduplicationKey: notice.key },
      transaction,
    );
  }

  purgeExpired(): Promise<number> {
    return this.repository.purgeExpired();
  }
}

type ExportNotice = { key: string; subject: string; body: string; metadata: Record<string, unknown> };

function readyNotice(exportId: string, expiresAt: Date): ExportNotice {
  const until = expiresAt.toLocaleDateString("es", { timeZone: env.BUSINESS_TIME_ZONE });
  return {
    key: `account-export.ready:${exportId}`,
    subject: "Tu copia de datos está lista",
    body: `Ya puedes descargar la copia de tus datos desde la app, en la sección de privacidad de tu cuenta. Está disponible hasta el ${until}; después la borramos.`,
    metadata: {
      type: "ACCOUNT_EXPORT_READY",
      exportId,
      downloadPath: downloadPathOf(exportId),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

function failedNotice(exportId: string): ExportNotice {
  return {
    key: `account-export.failed:${exportId}`,
    subject: "No pudimos preparar tu copia de datos",
    body: "Algo falló al preparar la copia de tus datos. Puedes pedirla otra vez desde la app 24 horas después de tu pedido anterior.",
    metadata: { type: "ACCOUNT_EXPORT_FAILED", exportId },
  };
}

function downloadPathOf(exportId: string): string {
  return `/me/export/${exportId}/download`;
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
    downloadPath: downloadable ? downloadPathOf(row.id) : null,
  };
}
