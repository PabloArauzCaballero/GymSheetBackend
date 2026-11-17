import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessDateService } from '../../common/time/business-date.service';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { groupSubscriptions, mapHistory, mapPeriod, PeriodDto, SubscriptionGroupDto } from './subscriptions.mapper';
import { SubscriptionViewsRepository } from './subscription-views.repository';

/** Periods read at most by «Mis suscripciones» (running ones and those ended within a year). */
const PERSON_PERIODS_MAX = 200;

/**
 * «Mis suscripciones» (ADR-0026, `me/subscriptions*`): the person's own
 * periods only; anyone else's is never found (404). Replaces `/me/membership`.
 */
@Injectable()
export class MeSubscriptionsService {
  constructor(
    private readonly views: SubscriptionViewsRepository,
    private readonly dates: BusinessDateService,
  ) {}

  async list(actor: AuthenticatedUser): Promise<{ items: SubscriptionGroupDto[]; today: string }> {
    const today = this.dates.today();
    const [rows, pending, socios] = await Promise.all([
      this.views.personPeriods(actor.id, today, PERSON_PERIODS_MAX),
      this.views.pendingOrders(actor.id),
      this.views.personSocios(actor.id),
    ]);
    return { items: groupSubscriptions(rows, pending, socios, today), today };
  }

  async get(actor: AuthenticatedUser, periodId: string) {
    const row = await this.views.personPeriod(actor.id, periodId);
    if (!row) throw new NotFoundException('Suscripción no encontrada.');
    const today = this.dates.today();
    const period: PeriodDto = mapPeriod(row, today);
    return {
      ...period,
      listing: { id: row.entityPlanId, name: row.planName, offerKind: row.offerKind },
      seller: row.entityId && row.sellerName ? { entityId: row.entityId, name: row.sellerName, handle: row.sellerHandle } : null,
      renew: row.entityPlanId ? { listingId: row.entityPlanId, available: row.renewable } : null,
      history: mapHistory(await this.views.history(row.id)),
    };
  }
}
