import { Injectable, Optional } from "@nestjs/common";
import { Transaction } from "sequelize";
import { OutboxService } from "../integration/outbox.service";
import { NotificationService } from "../notifications/notification.service";
import { SocialRecommendationOutboxService } from "../social/social-recommendation-outbox.service";
import { ModerationSafeguardsRepository } from "./moderation-safeguards.repository";
import { minorClosureNotice, minorSuspensionNotice, sendModerationNotice } from "./moderation-notices";
import { ModerationTargetKindValue } from "./moderation.policy";

/**
 * "Indefinite, pending review": `suspended_until` is a timestamp, and a real
 * far date keeps every existing suspension check working. Only a moderator
 * decision (dismiss or confirm) ends it, never the calendar.
 */
export const PENDING_REVIEW_SUSPENSION_UNTIL = new Date("9999-12-31T23:59:59.000Z");

/**
 * Drained by the account side once it exposes an internal closure (no password
 * or PIN, decided by moderation): it closes the account with data erasure.
 */
export const MINOR_ACCOUNT_CLOSURE_QUEUE = "account.minor-closure";
const MINOR_ACCOUNT_CLOSURE_EVENT = "moderation.minor-confirmed.v1";
const MINOR_ACCOUNT_CLOSURE_MAX_ATTEMPTS = 10;

/**
 * Accounts reported as belonging to a minor. The service is for adults only,
 * so a MENOR_DE_EDAD report suspends the account at once instead of climbing
 * the warning ladder, and a confirmed minor's account is closed and erased.
 * Staff accounts are excluded: the gym manages them, and a member must not be
 * able to lock out the front desk with one report.
 */
@Injectable()
export class ModerationMinorService {
  constructor(
    private readonly repository: ModerationSafeguardsRepository,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    @Optional() private readonly recommendationOutbox?: SocialRecommendationOutboxService,
  ) {}

  /** Runs inside the report transaction. Returns whether the account got suspended now. */
  async suspendPendingReview(userId: string, transaction: Transaction): Promise<boolean> {
    const suspended = await this.repository.suspendMemberUntil(userId, PENDING_REVIEW_SUSPENSION_UNTIL, transaction);
    if (!suspended) return false;
    await this.recommendationOutbox?.enqueueProfileSnapshot(userId, transaction);
    await sendModerationNotice(this.notifications, userId, minorSuspensionNotice(), `moderation.minor-suspended:${userId}:${Date.now()}`, transaction);
    return true;
  }

  /** A moderator confirmed a minor: keep the account suspended and request its closure. */
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
  }

  /** The case is closed without confirming a minor: the provisional suspension ends. */
  liftIfCleared(
    userId: string,
    target: { kind: ModerationTargetKindValue; id: string },
    transaction: Transaction,
  ): Promise<void> {
    return this.repository.liftProvisionalSuspension(userId, PENDING_REVIEW_SUSPENSION_UNTIL, target, transaction);
  }
}
