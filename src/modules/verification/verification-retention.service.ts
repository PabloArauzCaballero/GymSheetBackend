import { Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { MediaReleaseService } from "../media/media-release.service";
import { NotificationService } from "../notifications/notification.service";
import { retentionCutoffs, VERIFICATION_REVIEW_DEADLINE_DAYS } from "./verification.policy";
import { ExpiredReview, VerificationRepository } from "./verification.repository";

export interface VerificationRetentionResult {
  readonly expiredChallenges: number;
  /** Submitted selfies nobody decided within the review deadline; the member is told. */
  readonly expiredReviews: number;
  /** Selfie keys cleared; each file is queued on `media.release` in the same transaction. */
  readonly selfiesErased: number;
}

/** `aggregateType` of the `media.release` jobs that delete a selfie file. */
export const VERIFICATION_SELFIE_AGGREGATE = "social.photo_verifications";

const BATCH_SIZE = 100;

/**
 * Selfie retention (biometric data), a step of the daily privacy retention:
 *  - an unanswered challenge is closed (EXPIRED) 24 h after it was issued;
 *  - a submitted selfie nobody decided within `VERIFICATION_REVIEW_DEADLINE_DAYS`
 *    is closed (EXPIRED) and the member is told in the same transaction;
 *  - the selfie of an EXPIRED attempt is erased right away;
 *  - the selfie of a decided attempt (APPROVED/REJECTED) is erased 30 days
 *    after the decision.
 * The row keeps status and dates. Each batch clears the keys and queues the
 * files on the shared `media.release` outbox in ONE transaction, so a crash
 * or a storage outage can neither orphan a file nor lose the deletion: the
 * outbox retries with backoff, ends in dead-letter, re-checks references and
 * reports immutable storage instead of claiming a removal.
 */
@Injectable()
export class VerificationRetentionService {
  constructor(
    private readonly repository: VerificationRepository,
    private readonly mediaRelease: MediaReleaseService,
    private readonly notifications: NotificationService,
  ) {}

  async purge(now: Date): Promise<VerificationRetentionResult> {
    const { decidedBefore, issuedBefore, submittedBefore } = retentionCutoffs(now);
    const expiredChallenges = await this.repository.expireAbandoned(issuedBefore);
    const expiredReviews = await this.inBatches(async (transaction) => {
      const rows = await this.repository.expireStaleReviews(submittedBefore, BATCH_SIZE, transaction);
      for (const row of rows) await this.notifyReviewExpired(row, transaction);
      return rows.length;
    });
    const selfiesErased = await this.inBatches(async (transaction) => {
      const rows = await this.repository.clearDueSelfies(decidedBefore, now, BATCH_SIZE, transaction);
      for (const row of rows) {
        await this.mediaRelease.requestRelease(
          { aggregateType: VERIFICATION_SELFIE_AGGREGATE, aggregateId: row.id, storageKey: row.storageKey },
          transaction,
        );
      }
      return rows.length;
    });
    return { expiredChallenges, expiredReviews, selfiesErased };
  }

  /** Runs `batch` in its own transaction until one comes back short; returns the total. */
  private async inBatches(batch: (transaction: Transaction) => Promise<number>): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await this.repository.runInTransaction(batch);
      total += count;
      if (count < BATCH_SIZE) return total;
    }
  }

  private async notifyReviewExpired(row: ExpiredReview, transaction: Transaction): Promise<void> {
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: row.userId,
        channel: NotificationChannel.IN_APP,
        subject: "Tu verificación venció sin revisión",
        body: `El equipo de REPP no revisó tu selfie en ${VERIFICATION_REVIEW_DEADLINE_DAYS} días, así que la borramos. Puedes intentarlo de nuevo con un gesto nuevo.`,
        deduplicationKey: `verification.review-expired:${row.id}`,
        metadata: { kind: "PHOTO_VERIFICATION", verificationId: row.id, outcome: "REVIEW_EXPIRED" },
      },
      transaction,
    );
  }
}
