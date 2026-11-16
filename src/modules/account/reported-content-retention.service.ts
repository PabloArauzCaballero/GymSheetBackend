import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaReleaseService } from "../media/media-release.service";
import { REPORT_EVIDENCE_RETENTION_DAYS } from "../moderation/moderation.policy";
import {
  REPORTED_CONTENT_RETENTION_STEPS,
  ReportedContentStep,
  reportedContentBatchSql,
} from "./reported-content-retention.steps";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

type ChangedRow = { id: string; storageKey: string | null; provider: string | null };

/**
 * Erases the content an account closure kept because it was reported, once
 * every report on it was closed more than `REPORT_EVIDENCE_RETENTION_DAYS`
 * ago (the same window as the chat evidence copy). While any report on it is
 * open, or the last one closed more recently, it stays.
 *
 * Each batch is one transaction: the rows change and the release of their
 * files is queued on `media.release` together, skipping keys another row or
 * a moderation evidence copy still uses (the media worker checks again).
 * Runs from the privacy retention; tests call `purge(now)` with a fixed clock.
 */
@Injectable()
export class ReportedContentRetentionService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly references: MediaReferencesRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  /** Returns how many rows were erased per moderation target kind. */
  async purge(now: Date): Promise<Record<string, number>> {
    const resolvedBefore = new Date(now.getTime() - REPORT_EVIDENCE_RETENTION_DAYS * DAY_MS);
    const erased: Record<string, number> = {};
    for (const step of REPORTED_CONTENT_RETENTION_STEPS) {
      for (;;) {
        const changed = await this.sequelize.transaction((transaction) =>
          this.runBatch(step, resolvedBefore, transaction),
        );
        erased[step.kind] = (erased[step.kind] ?? 0) + changed;
        if (changed < BATCH_SIZE) break;
      }
    }
    return erased;
  }

  private async runBatch(step: ReportedContentStep, resolvedBefore: Date, transaction: Transaction): Promise<number> {
    const rows = await this.sequelize.query<ChangedRow>(reportedContentBatchSql(step), {
      type: QueryTypes.SELECT,
      replacements: { resolvedBefore, limit: BATCH_SIZE },
      transaction,
    });
    for (const row of rows) {
      if (!row.storageKey || (await this.references.isReferenced(row.storageKey, transaction))) continue;
      await this.mediaRelease.requestRelease(
        {
          aggregateType: "moderation.reported_content",
          aggregateId: row.id,
          storageKey: row.storageKey,
          ...(row.provider ? { provider: row.provider } : {}),
        },
        transaction,
      );
    }
    return rows.length;
  }
}
