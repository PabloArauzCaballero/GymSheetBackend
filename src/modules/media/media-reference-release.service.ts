import { Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "./media-references.repository";
import { MediaReleaseService } from "./media-release.service";

/** Who cleared the references and which files they pointed to. */
export type ClearedMediaReferences = {
  /** Owner of the cleared reference, e.g. "profile.photo" or "story". */
  aggregateType: string;
  aggregateId: string;
  /** Provider the files were written to; defaults to the configured one. */
  provider?: string;
  storageKeys: readonly string[];
};

/**
 * The synchronous deletions (a profile photo, a story, the stories purge, a
 * personal exercise upload) clear their reference here and, in the SAME
 * transaction, queue the file's removal on `media.release` when no other row
 * references it. A storage failure is then retried by the outbox with backoff
 * and ends visible in dead-letter, instead of failing the HTTP call after the
 * row is gone and never being retried (ADR-0017 §4).
 *
 * Each key is locked first (`pg_advisory_xact_lock`, sorted to avoid
 * deadlocks): without it, two transactions clearing the last two references
 * of the same file read each other as "still referenced" and neither queues
 * the release. Rows that keep the reference (content held as moderation
 * evidence, a shared content-addressed file) keep the file: `isReferenced`
 * sees them, and the media worker re-checks under the same lock before removing.
 */
@Injectable()
export class MediaReferenceReleaseService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly references: MediaReferencesRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  /** Returns how many files were queued for removal. */
  clearAndRelease(
    cleared: ClearedMediaReferences,
    clearReferences: (transaction: Transaction) => Promise<void>,
  ): Promise<number> {
    const storageKeys = [...new Set(cleared.storageKeys)].sort();
    return this.sequelize.transaction(async (transaction) => {
      for (const storageKey of storageKeys) await this.references.lockStorageKey(storageKey, transaction);
      await clearReferences(transaction);
      let queued = 0;
      for (const storageKey of storageKeys) {
        if (await this.references.isReferenced(storageKey, transaction)) continue;
        await this.mediaRelease.requestRelease(
          { aggregateType: cleared.aggregateType, aggregateId: cleared.aggregateId, provider: cleared.provider, storageKey },
          transaction,
        );
        queued += 1;
      }
      return queued;
    });
  }
}
