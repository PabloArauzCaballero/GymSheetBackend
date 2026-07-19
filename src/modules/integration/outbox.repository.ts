import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { QueueItemStatus } from '../../common/enums/domain.enums';
import { OutboxJobModel } from './outbox-job.model';

export type EnqueueOutboxJobInput = {
  queueName: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
  traceId?: string | null;
};

@Injectable()
export class OutboxRepository {
  constructor(
    @InjectModel(OutboxJobModel)
    private readonly jobs: typeof OutboxJobModel,
  ) {}

  enqueue(input: EnqueueOutboxJobInput, transaction: Transaction) {
    return this.jobs.create({
      ...input,
      status: QueueItemStatus.PENDING,
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: input.availableAt ?? new Date(),
      traceId: input.traceId ?? null,
    }, { transaction });
  }

  findByDeduplicationKey(key: string) {
    return this.jobs.findOne({ where: { deduplicationKey: key } });
  }
}
