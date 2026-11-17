import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/** A period as both sides read it; the date columns as `YYYY-MM-DD` text. */
export type PeriodRow = {
  id: string;
  entityId: string | null;
  entityPlanId: string | null;
  offerKind: string;
  planName: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
  sessionsTotal: number | null;
  sessionsUsed: number;
  origin: 'MARKETPLACE' | 'LEGACY';
  affiliationId: string | null;
  affiliationStatus: string | null;
};

/** What the person reads next to a period: the seller's public card and whether its listing is still on sale. */
export type PersonPeriodRow = PeriodRow & SellerCard & { renewable: boolean };

/** The seller's public card, as both a period and a pending order carry it. */
export type SellerCard = { entityId: string | null; sellerName: string | null; sellerHandle: string | null; sellerLogoUrl: string | null; sellerType: string | null };

export type PendingOrderRow = SellerCard & { id: string; orderNumber: string; status: string; entityPlanId: string; entityId: string; listingName: string };

/** What the business reads of a subscriber: the display name and the last payment of the period, nothing else personal. */
export type SubscriberRow = PeriodRow & {
  buyerName: string;
  orderNumber: string | null;
  amount: string | null;
  currency: string | null;
  method: string | null;
  paidAt: Date | null;
  locationName: string | null;
};

export type HistoryRow = { fromStatus: string | null; toStatus: string; reason: string | null; at: Date };

export type SubscriberFilter = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

const PERIOD = `m.id, m.entity_id AS "entityId", m.entity_plan_id AS "entityPlanId", m.offer_kind AS "offerKind",
  m.plan_name AS "planName", m.status, m.starts_on::text AS "startsOn", m.ends_on::text AS "endsOn",
  m.sessions_total AS "sessionsTotal", m.sessions_used AS "sessionsUsed", m.origin, m.affiliation_id AS "affiliationId",
  a.status AS "affiliationStatus"`;

/** The end date as a keyset key: no end sorts last. */
const END_KEY = `COALESCE(m.ends_on, DATE '9999-12-31')`;

/** One condition per filter of «Suscriptores»: the latest period of each (person, listing), seen from today. */
const FILTERS: Record<SubscriberFilter, string> = {
  ACTIVE: `m.status = 'ACTIVE' AND (m.ends_on IS NULL OR m.ends_on >= CAST(:today AS date))`,
  EXPIRING: `m.status = 'ACTIVE' AND m.ends_on BETWEEN CAST(:today AS date) AND CAST(:today AS date) + :expiringDays`,
  EXPIRED: `(m.status = 'EXPIRED' OR (m.status = 'ACTIVE' AND m.ends_on < CAST(:today AS date)))`,
  SUSPENDED: `m.status = 'SUSPENDED'`,
  CANCELLED: `m.status = 'CANCELLED'`,
};

/** Reads of the ledger for «Mis suscripciones» and the business's «Suscriptores». */
@Injectable()
export class SubscriptionViewsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * The person's periods: every one still running or ended within the last
   * year, newest end first, bounded (a person has few subscriptions; the
   * bound keeps a pathological account from loading its whole history).
   */
  personPeriods(userId: string, today: string, limit: number): Promise<PersonPeriodRow[]> {
    return this.sequelize.query<PersonPeriodRow>(
      `SELECT ${PERIOD}, e.name AS "sellerName", h.handle AS "sellerHandle", e.logo_url AS "sellerLogoUrl", e.entity_type AS "sellerType",
              COALESCE(ep.moderation_status = 'LIVE' AND ep.status = 'ACTIVE' AND e.status = 'ACTIVE', false) AS renewable
         FROM membership.memberships m
         LEFT JOIN directory.affiliations a ON a.id = m.affiliation_id
         LEFT JOIN directory.entities e ON e.id = m.entity_id
         LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
         LEFT JOIN directory.entity_plans ep ON ep.id = m.entity_plan_id
        WHERE m.user_id = :userId
          AND (m.status IN ('ACTIVE', 'SUSPENDED') OR m.ends_on IS NULL OR m.ends_on >= CAST(:today AS date) - 365)
        ORDER BY ${END_KEY} DESC, m.starts_on DESC, m.id
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { userId, today, limit } },
    );
  }

  /** The person's open orders of listings that open a period (a product is not a subscription). */
  pendingOrders(userId: string): Promise<PendingOrderRow[]> {
    return this.sequelize.query<PendingOrderRow>(
      `SELECT o.id, o.order_number AS "orderNumber", o.status, o.plan_id AS "entityPlanId", o.entity_id AS "entityId", ep.name AS "listingName",
              e.name AS "sellerName", h.handle AS "sellerHandle", e.logo_url AS "sellerLogoUrl", e.entity_type AS "sellerType"
         FROM directory.payment_orders o JOIN directory.entity_plans ep ON ep.id = o.plan_id
         JOIN directory.entities e ON e.id = o.entity_id
         LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
        WHERE o.athlete_user_id = :userId AND o.status IN ('PENDING_PAYMENT', 'PENDING_VERIFICATION') AND ep.offer_kind <> 'PRODUCT'
        ORDER BY o.created_at DESC`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  /** The person's live SOCIO rows (a confirmed one, and a pending «cambio de gimnasio» at most). */
  personSocios(userId: string): Promise<{ id: string; status: string; gymEntityId: string }[]> {
    return this.sequelize.query<{ id: string; status: string; gymEntityId: string }>(
      `SELECT id, status, gym_entity_id AS "gymEntityId" FROM directory.affiliations
        WHERE user_id = :userId AND kind = 'SOCIO' AND status IN ('REQUESTED', 'CONFIRMED')`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  async personPeriod(userId: string, periodId: string): Promise<PersonPeriodRow | null> {
    const [row] = await this.sequelize.query<PersonPeriodRow>(
      `SELECT ${PERIOD}, e.name AS "sellerName", h.handle AS "sellerHandle", e.logo_url AS "sellerLogoUrl", e.entity_type AS "sellerType",
              COALESCE(ep.moderation_status = 'LIVE' AND ep.status = 'ACTIVE' AND e.status = 'ACTIVE', false) AS renewable
         FROM membership.memberships m
         LEFT JOIN directory.affiliations a ON a.id = m.affiliation_id
         LEFT JOIN directory.entities e ON e.id = m.entity_id
         LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
         LEFT JOIN directory.entity_plans ep ON ep.id = m.entity_plan_id
        WHERE m.id = :periodId AND m.user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId, periodId } },
    );
    return row ?? null;
  }

  /** Status changes of a period, oldest first; never who made them. */
  history(periodId: string): Promise<HistoryRow[]> {
    return this.sequelize.query<HistoryRow>(
      `SELECT from_status AS "fromStatus", to_status AS "toStatus", reason, occurred_at AS at
         FROM membership.status_history WHERE membership_id = :periodId ORDER BY occurred_at, id`,
      { type: QueryTypes.SELECT, replacements: { periodId } },
    );
  }

  /**
   * «Suscriptores» of a seller: the latest period of each (person, listing)
   * sold on the marketplace (a legacy row is never shown to a business),
   * soonest to end first, keyset-paged on (end, id).
   */
  subscribers(
    entityId: string,
    query: { filter?: SubscriberFilter; today: string; expiringDays: number; after: { key: string; id: string } | null; limit: number },
  ): Promise<SubscriberRow[]> {
    const where = query.filter ? [FILTERS[query.filter]] : [];
    if (query.after) where.push(`(${END_KEY}, m.id) > (CAST(:afterKey AS date), CAST(:afterId AS uuid))`);
    return this.sequelize.query<SubscriberRow>(
      `${this.subscriberSelect()}
         FROM (SELECT DISTINCT ON (user_id, entity_plan_id) * FROM membership.memberships
                WHERE entity_id = :entityId AND origin = 'MARKETPLACE'
                ORDER BY user_id, entity_plan_id, starts_on DESC, created_at DESC) m
         ${this.subscriberJoins()}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${END_KEY}, m.id
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: { entityId, today: query.today, expiringDays: query.expiringDays, afterKey: query.after?.key ?? null, afterId: query.after?.id ?? null, limit: query.limit },
      },
    );
  }

  async subscriber(entityId: string, periodId: string): Promise<SubscriberRow | null> {
    const [row] = await this.sequelize.query<SubscriberRow>(
      `${this.subscriberSelect()} FROM membership.memberships m ${this.subscriberJoins()}
        WHERE m.id = :periodId AND m.entity_id = :entityId AND m.origin = 'MARKETPLACE'`,
      { type: QueryTypes.SELECT, replacements: { entityId, periodId } },
    );
    return row ?? null;
  }

  private subscriberSelect(): string {
    return `SELECT ${PERIOD}, u.nombre_completo AS "buyerName", o.order_number AS "orderNumber", o.amount, o.currency,
                   o.method, o.decided_at AS "paidAt", l.name AS "locationName"`;
  }

  private subscriberJoins(): string {
    return `JOIN public.usuarios u ON u.id = m.user_id
            LEFT JOIN directory.payment_orders o ON o.id = m.payment_order_id
            LEFT JOIN directory.affiliations a ON a.id = m.affiliation_id
            LEFT JOIN directory.entity_locations l ON l.id = a.location_id`;
  }
}
