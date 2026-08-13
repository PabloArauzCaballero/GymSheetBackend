import { Injectable } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';

export type OutboxPruneOptions = {
  retentionDays: number;
  batchSize: number;
  /** When false, only counts eligible rows without deleting anything. */
  apply: boolean;
};

export type OutboxPruneResult = {
  cutoff: Date;
  candidates: number;
  deleted: number;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Retention for the transactional outbox. Only COMPLETED jobs older than the
 * configured window are eligible; every other state is left untouched. Deletion
 * is opt-in (`apply`) so a dry run can report the impact before an operator
 * commits to it — see ADR-0005 on why the queue table is pruned while business
 * history tables stay append-only.
 */
@Injectable()
export class OutboxRetentionService {
  constructor(private readonly repository: OutboxRepository) {}

  async prune(options: OutboxPruneOptions): Promise<OutboxPruneResult> {
    const cutoff = new Date(Date.now() - options.retentionDays * MILLISECONDS_PER_DAY);
    const candidates = await this.repository.countCompletedBefore(cutoff);

    if (!options.apply) {
      return { cutoff, candidates, deleted: 0 };
    }

    let deleted = 0;
    for (;;) {
      const removed = await this.repository.deleteCompletedBefore(
        cutoff,
        options.batchSize,
      );
      deleted += removed;
      // A short batch means the eligible set is drained; stop looping.
      if (removed < options.batchSize) break;
    }

    return { cutoff, candidates, deleted };
  }
}
