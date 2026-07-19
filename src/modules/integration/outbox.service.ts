import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { EnqueueOutboxJobInput, OutboxRepository } from './outbox.repository';

@Injectable()
export class OutboxService {
  constructor(private readonly repository: OutboxRepository) {}

  enqueue(input: EnqueueOutboxJobInput, transaction: Transaction) {
    return this.repository.enqueue(input, transaction);
  }
}
