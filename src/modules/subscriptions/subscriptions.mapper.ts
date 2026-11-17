import { resolveMediaUrl } from '../../common/media/media-url';
import { daysLeft, shownStatus, ShownStatus } from './subscription.catalog';
import { HistoryRow, PendingOrderRow, PeriodRow, PersonPeriodRow, SellerCard, SubscriberRow } from './subscription-views.repository';

export type PeriodDto = {
  id: string;
  status: ShownStatus;
  startsOn: string;
  endsOn: string | null;
  daysLeft: number | null;
  sessions: { total: number; used: number } | null;
  origin: 'MARKETPLACE' | 'LEGACY';
};

export type SellerDto = { entityId: string; name: string; handle: string | null; logoUrl: string | null; entityType: string } | null;

/** One line of «Mis suscripciones»: a listing of a seller, its current period and what comes next. */
export type SubscriptionLineDto = {
  listing: { id: string | null; name: string; offerKind: string };
  status: ShownStatus | 'PENDING';
  current: PeriodDto | null;
  upcoming: PeriodDto | null;
  pendingOrder: { id: string; orderNumber: string; status: string } | null;
  renew: { listingId: string; available: boolean } | null;
};

export type SubscriptionGroupDto = {
  seller: SellerDto;
  affiliation: { id: string; status: string } | null;
  subscriptions: SubscriptionLineDto[];
};

export function mapPeriod(row: PeriodRow, today: string): PeriodDto {
  return {
    id: row.id,
    status: shownStatus(row, today),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    daysLeft: daysLeft(row, today),
    sessions: row.sessionsTotal === null ? null : { total: row.sessionsTotal, used: row.sessionsUsed },
    origin: row.origin,
  };
}

function sellerOf(row: SellerCard | null): SellerDto {
  if (!row?.entityId || !row.sellerName) return null;
  return { entityId: row.entityId, name: row.sellerName, handle: row.sellerHandle, logoUrl: resolveMediaUrl(row.sellerLogoUrl), entityType: row.sellerType ?? '' };
}

/** The period running today, else the latest; an upcoming one is a renewal chained after it. */
function line(periods: PersonPeriodRow[], pending: PendingOrderRow | null, today: string): SubscriptionLineDto {
  const sorted = [...periods].sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const upcoming = sorted.filter((row) => row.startsOn > today && row.status === 'ACTIVE').pop() ?? null;
  const current = sorted.find((row) => row !== upcoming && row.startsOn <= today) ?? sorted.find((row) => row !== upcoming) ?? null;
  const head = current ?? upcoming ?? periods[0];
  const listingId = head?.entityPlanId ?? pending?.entityPlanId ?? null;
  const currentDto = current ? mapPeriod(current, today) : null;
  return {
    listing: { id: listingId, name: head?.planName ?? pending?.listingName ?? 'Suscripción', offerKind: head?.offerKind ?? 'MEMBERSHIP' },
    status: currentDto?.status ?? (upcoming ? 'UPCOMING' : 'PENDING'),
    current: currentDto,
    upcoming: upcoming ? mapPeriod(upcoming, today) : null,
    pendingOrder: pending ? { id: pending.id, orderNumber: pending.orderNumber, status: pending.status } : null,
    renew: listingId ? { listingId, available: periods.some((row) => row.renewable) } : null,
  };
}

/**
 * «Mis suscripciones», grouped by seller (plan §2.10). A legacy period
 * without a known gym forms its own group with no seller. The gym where the
 * person is (or asked to be) SOCIO carries that affiliation's status.
 */
export function groupSubscriptions(
  rows: PersonPeriodRow[],
  pending: PendingOrderRow[],
  socios: { id: string; status: string; gymEntityId: string }[],
  today: string,
): SubscriptionGroupDto[] {
  type Group = { seller: SellerCard | null; lines: Map<string, PersonPeriodRow[]>; pending: PendingOrderRow[] };
  const groups = new Map<string, Group>();
  const groupOf = (key: string, seller: SellerCard | null): Group => {
    const group: Group = groups.get(key) ?? { seller, lines: new Map<string, PersonPeriodRow[]>(), pending: [] };
    group.seller = group.seller ?? seller;
    groups.set(key, group);
    return group;
  };
  for (const row of rows) {
    const group = groupOf(row.entityId ?? `legacy:${row.planName}`, row.entityId ? row : null);
    const key = row.entityPlanId ?? `legacy:${row.planName}`;
    group.lines.set(key, [...(group.lines.get(key) ?? []), row]);
  }
  for (const order of pending) groupOf(order.entityId, order).pending.push(order);
  return [...groups.values()].map((group) => {
      const lines = [...group.lines.entries()].map(([key, periods]) => line(periods, group.pending.find((order) => order.entityPlanId === key) ?? null, today));
      const orphans = group.pending.filter((order) => !group.lines.has(order.entityPlanId)).map((order) => line([], order, today));
      const seller = sellerOf(group.seller);
      const socio = socios.find((row) => row.gymEntityId === seller?.entityId);
      return {
        seller,
        affiliation: socio ? { id: socio.id, status: socio.status } : null,
        subscriptions: [...lines, ...orphans],
      };
    });
}

export function mapHistory(rows: HistoryRow[]): { fromStatus: string | null; toStatus: string; reasonCode: string | null; at: string }[] {
  return rows.map((row) => ({ fromStatus: row.fromStatus, toStatus: row.toStatus, reasonCode: row.reason, at: new Date(row.at).toISOString() }));
}

export type SubscriberDto = PeriodDto & {
  subscriber: { displayName: string };
  listing: { id: string | null; name: string; offerKind: string };
  affiliation: { id: string; status: string; location: string | null } | null;
  lastPayment: { orderNumber: string; amount: string; currency: string; method: string; paidAt: string | null } | null;
  actions: { canCancel: boolean; canSuspend: boolean; canReactivate: boolean };
};

export function mapSubscriber(row: SubscriberRow, today: string): SubscriberDto {
  const period = mapPeriod(row, today);
  const live = period.status !== 'EXPIRED' && period.status !== 'CANCELLED';
  return {
    ...period,
    subscriber: { displayName: row.buyerName },
    listing: { id: row.entityPlanId, name: row.planName, offerKind: row.offerKind },
    affiliation: row.affiliationId && row.affiliationStatus ? { id: row.affiliationId, status: row.affiliationStatus, location: row.locationName } : null,
    lastPayment: row.orderNumber
      ? { orderNumber: row.orderNumber, amount: String(row.amount), currency: (row.currency ?? '').trim(), method: row.method ?? 'QR', paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null }
      : null,
    actions: { canCancel: live, canSuspend: live && row.status === 'ACTIVE', canReactivate: live && row.status === 'SUSPENDED' },
  };
}
