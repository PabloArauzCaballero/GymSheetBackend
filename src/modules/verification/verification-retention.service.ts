import { Injectable } from "@nestjs/common";
import { MediaReleaseService } from "../media/media-release.service";
import { retentionCutoffs } from "./verification.policy";
import { VerificationRepository } from "./verification.repository";

export interface VerificationRetentionResult {
  readonly expiredChallenges: number;
  /** Selfie keys cleared; each file is queued on `media.release` in the same transaction. */
  readonly selfiesErased: number;
}

/** `aggregateType` of the `media.release` jobs that delete a selfie file. */
export const VERIFICATION_SELFIE_AGGREGATE = "social.photo_verifications";

const BATCH_SIZE = 100;

/**
 * Selfie retention (biometric data), a step of the daily privacy retention:
 *  - an unanswered challenge is closed (EXPIRED) 24 h after it was issued;
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
  ) {}

  async purge(now: Date): Promise<VerificationRetentionResult> {
    const { decidedBefore, issuedBefore } = retentionCutoffs(now);
    const expiredChallenges = await this.repository.expireAbandoned(issuedBefore);
    let selfiesErased = 0;
    for (;;) {
      const cleared = await this.repository.runInTransaction(async (transaction) => {
        const rows = await this.repository.clearDueSelfies(decidedBefore, now, BATCH_SIZE, transaction);
        for (const row of rows) {
          await this.mediaRelease.requestRelease(
            { aggregateType: VERIFICATION_SELFIE_AGGREGATE, aggregateId: row.id, storageKey: row.storageKey },
            transaction,
          );
        }
        return rows.length;
      });
      selfiesErased += cleared;
      if (cleared < BATCH_SIZE) break;
    }
    return { expiredChallenges, selfiesErased };
  }
}
