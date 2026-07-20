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
}
