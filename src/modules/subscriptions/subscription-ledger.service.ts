import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { MembershipStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { GymAffiliationsService } from '../affiliations/gym-affiliations.service';
import { PaymentOrderModel } from '../directory/models/payment-order.model';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { isPeriodKind, periodWindow, SoldOffer } from './subscription.catalog';
import { SubscriptionLedgerRepository } from './subscription-ledger.repository';

export type OpenedPeriod = { id: string; startsOn: string; endsOn: string | null };
type Seller = { entityId: string; entityType: string };

/**
 * Opens the period a confirmed order pays (ADR-0026), inside the caller's
 * transaction, with the person's lock already held: one order = one new
 * period (`uq_memberships_payment_order`), chained after the last ACTIVE one
 * of the same listing. A gym membership goes with the person's SOCIO
 * affiliation at that gym; when it is still REQUESTED and the business keeps
 * «también confirmo que es socio», it is confirmed in the same transaction, so
 * a failure of either leaves both as they were.
 */
@Injectable()
export class SubscriptionLedgerService {
  constructor(
    private readonly repository: SubscriptionLedgerRepository,
    private readonly gymAffiliations: GymAffiliationsService,
    private readonly events: DomainEventPublisher,
    private readonly dates: BusinessDateService,
  ) {}

  async openForOrder(
    order: PaymentOrderModel,
    seller: Seller,
    input: { actorUserId: string; confirmAffiliation: boolean },
    transaction: Transaction,
  ): Promise<OpenedPeriod | null> {
    const offer = await this.soldOffer(order, transaction);
    if (!offer) return null;
    const affiliationId = await this.affiliationFor(order, seller, offer, input, transaction);
    const lastEnd = await this.repository.lastActiveEnd(order.athleteUserId, order.planId, transaction);
    const window = periodWindow(offer, this.dates.today(), lastEnd);
    const period = await this.repository.create(
      {
        userId: order.athleteUserId,
        entityId: order.entityId,
        entityPlanId: order.planId,
        paymentOrderId: order.id,
        affiliationId,
        offerKind: offer.offerKind,
        planName: offer.name.slice(0, 180),
        sessionsTotal: window.sessionsTotal,
        sessionsUsed: 0,
        origin: 'MARKETPLACE',
        startsOn: window.startsOn,
        endsOn: window.endsOn,
        status: MembershipStatus.ACTIVE,
        externalReference: order.orderNumber,
        createdByUserId: input.actorUserId,
        metadata: {},
      },
      transaction,
    );
    const event = await this.events.record(
      {
        eventName: GymDomainEvent.SUBSCRIPTION_PERIOD_OPENED,
        aggregateType: 'membership',
        aggregateId: period.id,
        deduplicationKey: `subscription.period-opened:${order.id}`,
        actorUserId: input.actorUserId,
        payload: {
          membershipId: period.id,
          userId: order.athleteUserId,
          entityId: order.entityId,
          entityPlanId: order.planId,
          paymentOrderId: order.id,
          affiliationId,
          startsOn: window.startsOn,
          endsOn: window.endsOn,
        },
      },
      transaction,
    );
    await this.repository.recordStatus(
      { membershipId: period.id, fromStatus: null, toStatus: MembershipStatus.ACTIVE, reason: null, actorUserId: input.actorUserId, domainEventId: event.id, metadata: { paymentOrderId: order.id } },
      transaction,
    );
    return { id: period.id, startsOn: window.startsOn, endsOn: window.endsOn };
  }

  /**
   * Validity and sessions as sold (the order's snapshot), never as the
   * listing says today: a business editing its listing after the sale does
   * not change what was paid. A product opens no period.
   */
  private async soldOffer(order: PaymentOrderModel, transaction: Transaction): Promise<(SoldOffer & { name: string }) | null> {
    const snapshot = order.planSnapshot ?? {};
    const number = (value: unknown) => (typeof value === 'number' ? value : null);
    const listing = typeof snapshot.offerKind === 'string' ? null : await this.repository.listingOffer(order.planId, transaction);
    const offerKind = typeof snapshot.offerKind === 'string' ? snapshot.offerKind : listing?.offerKind;
    if (!isPeriodKind(offerKind)) return null;
    return {
      offerKind,
      validityDays: listing ? listing.validityDays : number(snapshot.validityDays),
      sessionsCount: listing ? listing.sessionsCount : number(snapshot.sessionsCount),
      name: typeof snapshot.name === 'string' ? snapshot.name : (listing?.name ?? 'Suscripción'),
    };
  }

  private async affiliationFor(
    order: PaymentOrderModel,
    seller: Seller,
    offer: SoldOffer,
    input: { actorUserId: string; confirmAffiliation: boolean },
    transaction: Transaction,
  ): Promise<string | null> {
    if (seller.entityType !== 'GYM' || offer.offerKind !== 'MEMBERSHIP') return null;
    const socio = await this.repository.liveSocioAt(order.athleteUserId, seller.entityId, transaction);
    if (socio?.status === 'REQUESTED' && input.confirmAffiliation) {
      await this.gymAffiliations.confirmInTransaction(seller.entityId, socio.id, input.actorUserId, transaction);
    }
    return socio?.id ?? null;
  }
}
