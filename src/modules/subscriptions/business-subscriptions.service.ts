import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception';
import { MembershipStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { BusinessAction, EXPIRING_WITHIN_DAYS, invalidTransition, targetOf } from './subscription.catalog';
import { SubscriptionLedgerRepository } from './subscription-ledger.repository';
import { SubscriptionNotices } from './subscription-notices';
import { SubscriptionViewsRepository } from './subscription-views.repository';
import { SubscriberDto, mapSubscriber } from './subscriptions.mapper';
import { PeriodDecisionInput, SubscribersQuery, decodeSubscriberCursor, encodeSubscriberCursor } from './subscriptions.schemas';

const NOTICE_OF = { CANCELLED: 'CANCELLED', SUSPENDED: 'SUSPENDED', ACTIVE: 'REACTIVATED' } as const;

function notFound(): NotFoundException {
  return new NotFoundException('Suscripción no encontrada.');
}

/**
 * «Suscriptores» of a business (ADR-0026, `business/me/subscriptions*`):
 * members and clients of ITS listings, with the expiry and the last payment;
 * replaces `admin/membership/insights/lapsed`. Every query is scoped to the
 * account's entity, so another business's period is 404, and a legacy row is
 * never shown to a business. The business may cancel, suspend and reactivate
 * a period with a reason; each change leaves its history row and its event.
 */
@Injectable()
export class BusinessSubscriptionsService {
  constructor(
    private readonly accounts: BusinessAccountsRepository,
    private readonly views: SubscriptionViewsRepository,
    private readonly ledger: SubscriptionLedgerRepository,
    private readonly events: DomainEventPublisher,
    private readonly notices: SubscriptionNotices,
    private readonly dates: BusinessDateService,
  ) {}

  async list(actor: AuthenticatedUser, query: SubscribersQuery): Promise<{ items: SubscriberDto[]; nextCursor: string | null; today: string }> {
    const { entityId } = await this.sellerOf(actor);
    const today = this.dates.today();
    const rows = await this.views.subscribers(entityId, {
      filter: query.status,
      today,
      expiringDays: EXPIRING_WITHIN_DAYS,
      after: decodeSubscriberCursor(query.cursor),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return { items: page.map((row) => mapSubscriber(row, today)), nextCursor: rows.length > query.limit && last ? encodeSubscriberCursor(last.endsOn, last.id) : null, today };
  }

  async get(actor: AuthenticatedUser, periodId: string): Promise<SubscriberDto> {
    const row = await this.views.subscriber((await this.sellerOf(actor)).entityId, periodId);
    if (!row) throw notFound();
    return mapSubscriber(row, this.dates.today());
  }

  /** Row-locked: two decisions at once give one change and one 409; a replay is 409 too. */
  async decide(actor: AuthenticatedUser, periodId: string, action: BusinessAction, input: PeriodDecisionInput | null): Promise<SubscriberDto> {
    if (input?.reasonCode === 'OTHER' && !input.note) {
      throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'SUBSCRIPTION_NOTE_REQUIRED', 'Explica el motivo para que la persona sepa qué pasó.');
    }
    const seller = await this.sellerOf(actor);
    await this.ledger.transaction(async (transaction) => {
      const period = await this.ledger.lockOfSeller(seller.entityId, periodId, transaction);
      if (!period) throw notFound();
      const to = targetOf(action, period, this.dates.today());
      if (!to) throw invalidTransition(period.status);
      const from = period.status;
      const now = new Date();
      await this.ledger.update(
        period,
        { status: to as MembershipStatus, suspendedAt: to === 'SUSPENDED' ? now : null, cancelledAt: to === 'CANCELLED' ? now : period.cancelledAt },
        transaction,
      );
      const event = await this.events.record(
        {
          eventName: GymDomainEvent.MEMBERSHIP_STATUS_CHANGED,
          aggregateType: 'membership',
          aggregateId: period.id,
          deduplicationKey: `membership.status-changed:${period.id}:${randomUUID()}`,
          actorUserId: actor.id,
          payload: { membershipId: period.id, userId: period.userId, fromStatus: from, toStatus: to as MembershipStatus, reason: input?.reasonCode ?? null },
        },
        transaction,
      );
      await this.ledger.recordStatus(
        { membershipId: period.id, fromStatus: from, toStatus: to as MembershipStatus, reason: input?.reasonCode ?? null, actorUserId: actor.id, domainEventId: event.id, metadata: input?.note ? { note: input.note } : {} },
        transaction,
      );
      await this.notices.send(
        period,
        seller.name,
        { event: NOTICE_OF[to], reasonCode: input?.reasonCode ?? null, note: input?.note ?? null, sequence: now.getTime() },
        transaction,
      );
    });
    return this.get(actor, periodId);
  }

  private async sellerOf(actor: AuthenticatedUser): Promise<{ entityId: string; name: string }> {
    const account = await this.accounts.findByUserId(actor.id);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    const entity = await this.accounts.findEntity(account.entityId);
    return { entityId: account.entityId, name: entity?.name ?? 'El negocio' };
  }
}
