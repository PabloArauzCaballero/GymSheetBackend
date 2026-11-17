import { Injectable, Optional } from "@nestjs/common";
import { Transaction } from "sequelize";
import { PENDING_REVIEW_SUSPENSION_UNTIL } from "../../common/moderation/account-suspension";
import { env } from "../../config/env";
import { OutboxService } from "../integration/outbox.service";
import { NotificationService } from "../notifications/notification.service";
import { NoticeEmailService } from "../notifications/notice-email.service";
import { SocialRecommendationOutboxService } from "../social/social-recommendation-outbox.service";
import { ModerationSafeguardsRepository } from "./moderation-safeguards.repository";
import {
  emailModerationNotice,
  minorClosureNotice,
  minorReviewClearedNotice,
  minorSuspensionNotice,
  sendModerationNotice,
} from "./moderation-notices";
import { ModerationTargetKind, ModerationTargetKindValue } from "./moderation.policy";

const HOUR_MS = 60 * 60 * 1000;
/**
 * The automatic suspension needs corroboration: this many DISTINCT reporters
 * of the same tenant, within the window, reporting the profile itself. One
 * report alone only puts the case at the top of the queue (critical severity).
 */
export const MINOR_SUSPENSION_MIN_REPORTERS = 2;
export const MINOR_SUSPENSION_WINDOW_MS = 7 * 24 * HOUR_MS;
/** Beyond this many MENOR_DE_EDAD reports per reporter and window, a report is kept but does not count. */
export const MINOR_REPORTS_PER_REPORTER_LIMIT = 3;
export const MINOR_REPORTS_PER_REPORTER_WINDOW_MS = 24 * HOUR_MS;

export type MinorReportContext = { reportedUserId: string; tenantId: string; targetKind: ModerationTargetKindValue };

/**
 * Drained by the account-data worker (`AccountClosureService.closeByModeration`):
 * the same erasure as a self-service closure, without password or PIN.
 */
export const MINOR_ACCOUNT_CLOSURE_QUEUE = "account.minor-closure";
const MINOR_ACCOUNT_CLOSURE_EVENT = "moderation.minor-confirmed.v1";
const MINOR_ACCOUNT_CLOSURE_MAX_ATTEMPTS = 10;

/**
 * Accounts reported as belonging to a minor. The service is for adults only,
 * so corroborated MENOR_DE_EDAD reports suspend the account at once instead
 * of climbing the warning ladder, and a confirmed minor's account is closed
 * and erased. A single report never suspends: otherwise anyone could lock out
 * any member indefinitely with one tap.
 * Only member accounts are concerned: a platform or business account is not
 * a person reported as a minor, and a member must not lock out REPP with a report.
 */
@Injectable()
export class ModerationMinorService {
  constructor(
    private readonly repository: ModerationSafeguardsRepository,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly noticeEmails: NoticeEmailService,
    @Optional() private readonly recommendationOutbox?: SocialRecommendationOutboxService,
  ) {}

  /**
   * Runs inside the report transaction, after the report row exists. Returns
   * whether the account got suspended now.
   */
  async suspendIfCorroborated(report: MinorReportContext, transaction: Transaction, now: Date = new Date()): Promise<boolean> {
    if (report.targetKind !== ModerationTargetKind.USER) return false;
    const reporters = await this.repository.countCorroboratingMinorReporters(
      {
        userId: report.reportedUserId,
        tenantId: report.tenantId,
        defaultTenantId: env.DEFAULT_TENANT_ID,
        since: new Date(now.getTime() - MINOR_SUSPENSION_WINDOW_MS),
        perReporterLimit: MINOR_REPORTS_PER_REPORTER_LIMIT,
        rateWindowMs: MINOR_REPORTS_PER_REPORTER_WINDOW_MS,
      },
      transaction,
    );
    if (reporters < MINOR_SUSPENSION_MIN_REPORTERS) return false;
    return this.suspendPendingReview(report.reportedUserId, transaction);
  }

  private async suspendPendingReview(userId: string, transaction: Transaction): Promise<boolean> {
    const suspended = await this.repository.suspendMemberUntil(userId, PENDING_REVIEW_SUSPENSION_UNTIL, transaction);
    if (!suspended) return false;
    await this.recommendationOutbox?.enqueueProfileSnapshot(userId, transaction);
    const key = `moderation.minor-suspended:${userId}:${Date.now()}`;
    await sendModerationNotice(this.notifications, userId, minorSuspensionNotice(), key, transaction);
    await emailModerationNotice(this.noticeEmails, userId, minorSuspensionNotice(), key, { transaction });
    return true;
  }

  /**
   * A moderator confirmed a minor: keep the account suspended and request its
   * closure. The email is written here, before the closure job runs, to the
   * address on file now, and is exempt from the closure's purge: the closure
   * erases the in-app notice and the address, the email still arrives.
   */
  async confirm(userId: string, transaction: Transaction): Promise<void> {
    await this.repository.suspendMemberUntil(userId, PENDING_REVIEW_SUSPENSION_UNTIL, transaction);
    await this.recommendationOutbox?.enqueueProfileSnapshot(userId, transaction);
    await this.outbox.enqueue(
      {
        queueName: MINOR_ACCOUNT_CLOSURE_QUEUE,
        eventType: MINOR_ACCOUNT_CLOSURE_EVENT,
        aggregateType: "account",
        aggregateId: userId,
        deduplicationKey: `account-minor-closure:${userId}`,
        payload: { schemaVersion: 1, userId },
        maxAttempts: MINOR_ACCOUNT_CLOSURE_MAX_ATTEMPTS,
      },
      transaction,
    );
    await sendModerationNotice(this.notifications, userId, minorClosureNotice(), `moderation.minor-confirmed:${userId}`, transaction);
    await emailModerationNotice(this.noticeEmails, userId, minorClosureNotice(), `moderation.minor-confirmed:${userId}`, {
      survivesClosure: true,
      transaction,
    });
  }

  /**
   * The case is closed without confirming a minor: the provisional suspension
   * ends, and the person is told in the app and by email (the same notice
   * email as the suspension) that the review ended. `sanctionFollows` is set
   * when this same review applies another sanction, so the notice does not
   * promise an account that is about to be suspended again.
   */
  async liftIfCleared(
    userId: string,
    target: { kind: ModerationTargetKindValue; id: string },
    transaction: Transaction,
    options: { sanctionFollows: boolean },
  ): Promise<void> {
    const lifted = await this.repository.liftProvisionalSuspension(userId, PENDING_REVIEW_SUSPENSION_UNTIL, target, transaction);
    if (!lifted) return;
    const notice = minorReviewClearedNotice(lifted.suspendedUntil !== null || options.sanctionFollows);
    const key = `moderation.minor-cleared:${userId}:${Date.now()}`;
    await sendModerationNotice(this.notifications, userId, notice, key, transaction);
    await emailModerationNotice(this.noticeEmails, userId, notice, key, { transaction });
  }
}
