import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueueItemStatus } from '../../common/enums/domain.enums';
import { OutboxJobModel } from './outbox-job.model';

export type EnqueueOutboxJobInput = {
  queueName: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  domainEventId?: string | null;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
  traceId?: string | null;
};

export type FailedOutboxUpdate = {
  deadLetter: boolean;
  updated: boolean;
};

/** Count of jobs in a single actionable state for one queue. */
export type QueueDepthRow = {
  queueName: string;
  status: QueueItemStatus;
  count: number;
};

/** Age of the oldest job that is due to run but has not been completed. */
export type QueueBacklogAgeRow = {
  queueName: string;
  ageSeconds: number;
};

export type QueueMetricsSnapshot = {
  depth: QueueDepthRow[];
  backlogAge: QueueBacklogAgeRow[];
};

@Injectable()
export class OutboxRepository {
  constructor(
    @InjectModel(OutboxJobModel)
    private readonly jobs: typeof OutboxJobModel,
    private readonly sequelize: Sequelize,
  ) {}

  enqueue(input: EnqueueOutboxJobInput, transaction: Transaction) {
    return this.jobs.create(
      {
        ...input,
        domainEventId: input.domainEventId ?? null,
        status: QueueItemStatus.PENDING,
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 5,
        availableAt: input.availableAt ?? new Date(),
        traceId: input.traceId ?? null,
      },
      { transaction },
    );
  }

  async claim(
    queueName: string,
    workerId: string,
    limit: number,
    lockTimeoutMs: number,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      const rows = await this.sequelize.query<{ id: string }>(
        `WITH candidates AS (
           SELECT id
           FROM integration.outbox_jobs
           WHERE queue_name = :queueName
             AND available_at <= now()
             AND (
               status IN ('PENDING','FAILED')
               OR (
                 status = 'PROCESSING'
                 AND locked_at < now() - (:lockTimeoutMs * interval '1 millisecond')
               )
             )
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT :limit
         )
         UPDATE integration.outbox_jobs job
         SET status = 'PROCESSING',
             attempt_count = job.attempt_count + 1,
             locked_at = now(),
             locked_by = :workerId,
             updated_at = now()
         FROM candidates
         WHERE job.id = candidates.id
         RETURNING job.id`,
        {
          replacements: { queueName, workerId, limit, lockTimeoutMs },
          type: QueryTypes.SELECT,
          transaction,
        },
      );

      if (rows.length === 0) return [];

      return this.jobs.findAll({
        where: { id: rows.map(({ id }) => id) },
        order: [['createdAt', 'ASC']],
        transaction,
      });
    });
  }

  async markCompleted(
    jobId: string,
    workerId: string,
    attemptCount: number,
  ): Promise<boolean> {
    const [updatedRows] = await this.jobs.update(
      {
        status: QueueItemStatus.COMPLETED,
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      {
        where: {
          id: jobId,
          status: QueueItemStatus.PROCESSING,
          lockedBy: workerId,
          attemptCount,
        },
      },
    );
    return updatedRows === 1;
  }

  async markFailed(
    job: OutboxJobModel,
    workerId: string,
    errorMessage: string,
  ): Promise<FailedOutboxUpdate> {
    const deadLetter = job.attemptCount >= job.maxAttempts;
    const delaySeconds = Math.min(
      3600,
      2 ** Math.min(job.attemptCount, 10) * 5,
    );
    const availableAt = new Date(Date.now() + delaySeconds * 1000);
    const [updatedRows] = await this.jobs.update(
      {
        status: deadLetter
          ? QueueItemStatus.DEAD_LETTER
          : QueueItemStatus.FAILED,
        availableAt,
        lockedAt: null,
        lockedBy: null,
        lastError: errorMessage.slice(0, 4000),
      },
      {
        where: {
          id: job.id,
          status: QueueItemStatus.PROCESSING,
          lockedBy: workerId,
          attemptCount: job.attemptCount,
        },
      },
    );

    return { deadLetter, updated: updatedRows === 1 };
  }

  findByDeduplicationKey(key: string) {
    return this.jobs.findOne({ where: { deduplicationKey: key } });
  }

  /**
   * Aggregates queue depth for observability. Deliberately restricted to the
   * actionable states (PENDING/PROCESSING/FAILED/DEAD_LETTER): those rows are
   * bounded by throughput and the `ix_outbox_claim` index covers them by its
   * `(queue_name, status, ...)` prefix. COMPLETED is excluded on purpose — it is
   * append-only and grows without bound (see ADR-0005), so counting it on every
   * scrape would turn the metrics endpoint into a full-table scan.
   */
  async aggregateQueueMetrics(): Promise<QueueMetricsSnapshot> {
    const [depth, backlogAge] = await Promise.all([
      this.sequelize.query<QueueDepthRow>(
        `SELECT queue_name AS "queueName", status, count(*)::int AS count
           FROM integration.outbox_jobs
          WHERE status IN ('PENDING','PROCESSING','FAILED','DEAD_LETTER')
          GROUP BY queue_name, status`,
        { type: QueryTypes.SELECT },
      ),
      this.sequelize.query<QueueBacklogAgeRow>(
        `SELECT queue_name AS "queueName",
                EXTRACT(EPOCH FROM (now() - min(available_at)))::float8 AS "ageSeconds"
           FROM integration.outbox_jobs
          WHERE status IN ('PENDING','FAILED')
            AND available_at <= now()
          GROUP BY queue_name`,
        { type: QueryTypes.SELECT },
      ),
    ]);

    return { depth, backlogAge };
  }

  /** Counts COMPLETED jobs whose processing finished before the cutoff. */
  async countCompletedBefore(cutoff: Date): Promise<number> {
    const rows = await this.sequelize.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM integration.outbox_jobs
        WHERE status = 'COMPLETED' AND processed_at < :cutoff`,
      { replacements: { cutoff }, type: QueryTypes.SELECT },
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Deletes one bounded batch of COMPLETED jobs older than the cutoff and
   * returns how many rows were removed. Restricted to COMPLETED on purpose:
   * PENDING/PROCESSING/FAILED are live work and DEAD_LETTER needs human triage,
   * so none of them are ever eligible for pruning. `SKIP LOCKED` keeps the sweep
   * from contending with the workers' claim query.
   */
  async deleteCompletedBefore(cutoff: Date, batchSize: number): Promise<number> {
    const rows = await this.sequelize.query<{ id: string }>(
      `WITH victims AS (
         SELECT id
           FROM integration.outbox_jobs
          WHERE status = 'COMPLETED' AND processed_at < :cutoff
          LIMIT :batchSize
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM integration.outbox_jobs job
       USING victims
       WHERE job.id = victims.id
       RETURNING job.id`,
      { replacements: { cutoff, batchSize }, type: QueryTypes.SELECT },
    );
    return rows.length;
  }
}
