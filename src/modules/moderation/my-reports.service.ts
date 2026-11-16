import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";
import { transactionWithRetry } from "../../common/sql/transaction-retry";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { ModerationRepository } from "./moderation.repository";
import { MyReportsRepository } from "./my-reports.repository";
import {
  AUTO_HIDE_DISTINCT_REPORTERS,
  isHideableTarget,
  isOpenModerationStatus,
  withdrawalStatus,
} from "./moderation.policy";
import { encodeMyReportsCursor, MyReportsQuery } from "./moderation.schemas";
import { toMyReportDto } from "./my-reports.mapper";

/**
 * «Tus denuncias»: what a person reported, and taking a report back.
 *
 * Withdrawing never deletes the row (it is the moderation record) and never
 * undoes a moderator's verdict. What it ends is what the report did for the
 * reporter: the content stops being hidden from them in lists, and an open
 * report leaves the queue. It does not restore connections or chats the report
 * severed; reconnecting is the person's own, explicit step.
 */
@Injectable()
export class MyReportsService {
  private readonly logger = new Logger(MyReportsService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: MyReportsRepository,
    private readonly moderation: ModerationRepository,
  ) {}

  async list(reporter: AuthenticatedUser, query: MyReportsQuery) {
    const rows = await this.repository.listLive(reporter.id, query.limit + 1, query.cursor);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toMyReportDto),
      nextCursor: rows.length > query.limit && last ? encodeMyReportsCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  /**
   * Idempotent: withdrawing twice answers the first withdrawal again, so a
   * double tap on «Retirar» is not an error.
   *
   * When an open report is withdrawn and the content had been hidden only by the
   * automatic threshold, the curtain is lifted if the remaining distinct
   * reporters fall below it. Otherwise a group could hide something and then
   * all withdraw, leaving it hidden with no case left for anyone to review.
   */
  async withdraw(reporter: AuthenticatedUser, reportId: string) {
    // Lock order: the report row first, content after; resolving and
    // auto-hiding take the target's open reports first too (no deadlock cycle).
    const result = await transactionWithRetry(this.sequelize, async (transaction) => {
      const report = await this.repository.findOwnForUpdate(reportId, reporter.id, transaction);
      if (!report) throw new NotFoundException("No encontramos esa denuncia.");
      if (report.withdrawnAt) {
        return { report, withdrawnAt: report.withdrawnAt, contentRestored: false, changed: false };
      }

      const wasOpen = isOpenModerationStatus(report.status);
      const status = withdrawalStatus(report.status);
      const withdrawnAt = await this.repository.markWithdrawn(report.id, status, transaction);

      let contentRestored = false;
      if (wasOpen && isHideableTarget(report.targetKind)) {
        const remaining = await this.moderation.countDistinctReporters(report.targetKind, report.targetId, transaction);
        if (remaining < AUTO_HIDE_DISTINCT_REPORTERS) {
          contentRestored = await this.repository.revealAutoHidden(report.targetKind, report.targetId, transaction);
        }
      }
      return { report, withdrawnAt, contentRestored, changed: true };
    });

    if (result.changed) {
      this.logger.log(
        {
          event: "moderation.report_withdrawn",
          reportId: result.report.id,
          targetKind: result.report.targetKind,
          leftQueue: isOpenModerationStatus(result.report.status),
          contentRestored: result.contentRestored,
        },
        MyReportsService.name,
      );
    }

    return {
      id: result.report.id,
      withdrawn: true,
      withdrawnAt: new Date(result.withdrawnAt).toISOString(),
      contentRestored: result.contentRestored,
    };
  }
}
