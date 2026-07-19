import { GymDomainEvent } from './domain-event.catalog';
import { DomainEventPublisher } from './domain-event.publisher';

describe('DomainEventPublisher', () => {
  const transaction = {} as never;
  const domainEvent = { id: '550e8400-e29b-41d4-a716-446655440001' };
  const events = {
    create: jest.fn().mockResolvedValue(domainEvent),
  };
  const outbox = {
    enqueue: jest.fn().mockResolvedValue({ id: 'job-id' }),
  };
  const publisher = new DomainEventPublisher(events as never, outbox as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records the immutable event before linking all requested deliveries', async () => {
    const input = {
      eventName: GymDomainEvent.CUSTOMER_REGISTERED,
      aggregateType: 'customer_profile',
      aggregateId: '550e8400-e29b-41d4-a716-446655440002',
      deduplicationKey: 'customer.registered:user-1',
      actorUserId: '550e8400-e29b-41d4-a716-446655440003',
      payload: {
        userId: '550e8400-e29b-41d4-a716-446655440004',
        customerProfileId: '550e8400-e29b-41d4-a716-446655440002',
        customerNumber: 'SCZ-001',
        pinCredentialId: '550e8400-e29b-41d4-a716-446655440005',
        notificationPreferenceId: '550e8400-e29b-41d4-a716-446655440006',
      },
    } as const;

    await publisher.recordAndEnqueue(
      input,
      [
        {
          queueName: 'customer.projections',
          deduplicationKey: 'customer.projection:user-1',
          payload: { userId: input.payload.userId },
        },
        {
          queueName: 'customer.audit-export',
          deduplicationKey: 'customer.audit:user-1',
          payload: { profileId: input.payload.customerProfileId },
        },
      ],
      transaction,
    );

    expect(events.create).toHaveBeenCalledWith(input, transaction);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(outbox.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        domainEventId: domainEvent.id,
        eventType: GymDomainEvent.CUSTOMER_REGISTERED,
        queueName: 'customer.projections',
      }),
      transaction,
    );
  });

  it('records an event without manufacturing a queue when no consumer exists', async () => {
    const input = {
      eventName: GymDomainEvent.MEMBERSHIP_ACTIVATED,
      aggregateType: 'membership',
      aggregateId: '550e8400-e29b-41d4-a716-446655440010',
      deduplicationKey: 'membership.activated:membership-1',
      payload: {
        membershipId: '550e8400-e29b-41d4-a716-446655440010',
        userId: '550e8400-e29b-41d4-a716-446655440011',
        planId: '550e8400-e29b-41d4-a716-446655440012',
        startsOn: '2026-07-19',
        endsOn: '2026-08-17',
      },
    } as const;

    await publisher.record(input, transaction);

    expect(events.create).toHaveBeenCalledWith(input, transaction);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
