import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import {
  GymDomainEventName,
  RecordGymDomainEventInput,
} from './domain-event.catalog';
import { DomainEventModel } from './domain-event.model';

@Injectable()
export class DomainEventRepository {
  constructor(
    @InjectModel(DomainEventModel)
    private readonly events: typeof DomainEventModel,
  ) {}

  create<TName extends GymDomainEventName>(
    input: RecordGymDomainEventInput<TName>,
    transaction: Transaction,
  ) {
    return this.events.create(
      {
        ...input,
        eventVersion: 1,
        actorUserId: input.actorUserId ?? null,
        correlationId: input.correlationId ?? null,
        causationEventId: input.causationEventId ?? null,
        traceId: input.traceId ?? null,
        metadata: input.metadata ?? {},
      },
      { transaction },
    );
  }

  findByDeduplicationKey(
    deduplicationKey: string,
    transaction?: Transaction,
  ) {
    return this.events.findOne({
      where: { deduplicationKey },
      transaction,
    });
  }
}
