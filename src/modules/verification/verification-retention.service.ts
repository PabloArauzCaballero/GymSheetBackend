import { Inject, Injectable, Logger } from "@nestjs/common";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { retentionCutoffs } from "./verification.policy";
import { VerificationRepository } from "./verification.repository";

export interface VerificationRetentionResult {
  readonly expiredChallenges: number;
  readonly selfiesErased: number;
  readonly failed: number;
}

/** Retry seam: production waits between storage attempts, tests do not. */
export const VERIFICATION_RETENTION_SLEEP = Symbol("VERIFICATION_RETENTION_SLEEP");
export type RetentionSleep = (ms: number) => Promise<void>;

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

/**
 * Selfie retention (biometric data):
 *  - an unanswered challenge is closed (EXPIRED) 24 h after it was issued;
 *  - the selfie of an EXPIRED attempt is erased right away;
 *  - the selfie of a decided attempt (APPROVED/REJECTED) is erased 30 days
 *    after the decision.
 * The row keeps status and dates. The file is removed BEFORE the key is
 * cleared: if the update fails the next run retries an idempotent remove; the
 * opposite order would orphan a biometric file nobody can find again. There is
 * no media-deletion outbox in this code base, so storage calls retry with
 * backoff and failures stay in the table for the next run.
 */
@Injectable()
export class VerificationRetentionService {
  private readonly logger = new Logger(VerificationRetentionService.name);

  constructor(
    private readonly repository: VerificationRepository,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    @Inject(VERIFICATION_RETENTION_SLEEP) private readonly sleep: RetentionSleep,
  ) {}

  async purge(now: Date): Promise<VerificationRetentionResult> {
    const { decidedBefore, issuedBefore } = retentionCutoffs(now);
    const expiredChallenges = await this.repository.expireAbandoned(issuedBefore);
    let selfiesErased = 0;
    let failed = 0;
    const skipped = new Set<string>();

    for (;;) {
      const batch = (await this.repository.findSelfiesToErase(decidedBefore, BATCH_SIZE + skipped.size))
        .filter((row) => !skipped.has(row.id));
      if (batch.length === 0) break;
      for (const row of batch) {
        if (row.selfieStorageKey && (await this.eraseFile(row.id, row.selfieStorageKey))) {
          await this.repository.clearSelfie(row.id, row.selfieStorageKey, now);
          selfiesErased += 1;
        } else {
          failed += 1;
          skipped.add(row.id);
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }
    return { expiredChallenges, selfiesErased, failed };
  }

  private async eraseFile(verificationId: string, storageKey: string): Promise<boolean> {
    if (this.storage.immutable) {
      this.logger.warn({ event: "verification.retention.file_kept", verificationId, reason: "immutable_storage" });
      return false;
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.storage.remove(storageKey);
        return true;
      } catch (error: unknown) {
        this.logger.warn({
          event: "verification.retention.remove_failed",
          verificationId,
          attempt,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        if (attempt < MAX_ATTEMPTS) await this.sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    return false;
  }
}
