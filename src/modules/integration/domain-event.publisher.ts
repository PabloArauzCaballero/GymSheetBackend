import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import {
  GymDomainEventName,
  RecordGymDomainEventInput,
} from './domain-event.catalog';
import { DomainEventRepository } from './domain-event.repository';
import { OutboxService } from './outbox.service';

export type DomainEventDelivery = {
  queueName: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
};

@Injectable()
export class DomainEventPublisher {
  constructor(
    private readonly events: DomainEventRepository,
    private readonly outbox: OutboxService,
  ) {}

  record<TName extends GymDomainEventName>(
    input: RecordGymDomainEventInput<TName>,
    transaction: Transaction,
  ) {
    return this.events.create(input, transaction);
  }

  async recordAndEnqueue<TName extends GymDomainEventName>(
    input: RecordGymDomainEventInput<TName>,
    deliveries: readonly DomainEventDelivery[],
    transaction: Transaction,
  ) {
    const event = await this.events.create(input, transaction);

    for (const delivery of deliveries) {
      await this.outbox.enqueue(
        {
          queueName: delivery.queueName,
          eventType: input.eventName,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          domainEventId: event.id,
          deduplicationKey: delivery.deduplicationKey,
          payload: delivery.payload,
          maxAttempts: delivery.maxAttempts,
          availableAt: delivery.availableAt,
          traceId: input.traceId ?? null,
        },
        transaction,
      );
    }

    return event;
  }
}
