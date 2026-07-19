import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { OutboxJobModel } from './outbox-job.model';
import { EnqueueOutboxJobInput, OutboxRepository } from './outbox.repository';

@Injectable()
export class OutboxService {
  constructor(private readonly repository: OutboxRepository) {}

  enqueue(input: EnqueueOutboxJobInput, transaction: Transaction) {
    return this.repository.enqueue(input, transaction);
  }

  claim(queueName: string, workerId: string, limit: number, lockTimeoutMs: number) {
    return this.repository.claim(queueName, workerId, limit, lockTimeoutMs);
  }

  complete(jobId: string) {
    return this.repository.markCompleted(jobId);
  }

  fail(job: OutboxJobModel, error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    return this.repository.markFailed(job, message);
  }
}
