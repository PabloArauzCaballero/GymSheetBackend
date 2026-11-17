import { Gym, gymWithLocations } from './affiliations-e2e';
import { KycHarness } from './kyc-e2e';
import { createListing, membership } from './listings-e2e';
import { order, uploadReceipt } from './orders-e2e';

export type GymSeller = Gym & { listingId: string };

/** A public gym with two locations, its payment data and QR, cash accepted, and one 30-day membership. */
export async function gymSeller(h: KycHarness, label: string): Promise<GymSeller> {
  const gym = await gymWithLocations(h, label);
  await h.e2e
    .as(gym.token)
    .put('/business/me/payment-config')
    .send({ bankName: 'Banco Unión', accountHolderName: 'Representante Prueba', accountNumber: '1000-2000', acceptsCash: true })
    .expect(200);
  await h.e2e.as(gym.token).put('/business/me/payment-config/qr').attach('file', h.logo, { filename: 'qr.png', contentType: 'image/png' }).expect(200);
  const listing = await createListing(h, gym, membership());
  return { ...gym, listingId: listing.id };
}

/** The checkout data a gym membership asks a person who is not yet its SOCIO. */
export function socioData(gym: Gym, extra: Record<string, unknown> = {}) {
  return { locationId: gym.locations[0], ciLast3: '456', ...extra };
}

/** An order paid in cash (waiting for the business), ready to be confirmed. */
export async function cashOrder(h: KycHarness, token: string, body: Record<string, unknown>) {
  return order(h, token, { method: 'CASH', ...body });
}

/** An order paid by QR with its receipt sent. */
export async function paidOrder(h: KycHarness, token: string, body: Record<string, unknown>) {
  const created = await order(h, token, body);
  await uploadReceipt(h, token, created.id).expect(200);
  return created;
}

export function confirmOrder(h: KycHarness, seller: { token: string }, orderId: string, body?: Record<string, unknown>) {
  const pending = h.e2e.as(seller.token).post(`/business/me/orders/${orderId}/confirm`);
  return body ? pending.send(body) : pending;
}

export type LedgerRow = {
  id: string;
  startsOn: string;
  endsOn: string | null;
  status: string;
  origin: string;
  offerKind: string;
  affiliationId: string | null;
  sessionsTotal: number | null;
};

/** The periods an order or a person has in the ledger, oldest first. */
export async function periodsOf(h: KycHarness, where: { orderId?: string; userId?: string }): Promise<LedgerRow[]> {
  return h.select<LedgerRow>(
    `SELECT id, starts_on::text AS "startsOn", ends_on::text AS "endsOn", status, origin, offer_kind AS "offerKind",
            affiliation_id AS "affiliationId", sessions_total AS "sessionsTotal"
       FROM membership.memberships
      WHERE ${where.orderId ? 'payment_order_id = :orderId' : 'user_id = :userId'}
      ORDER BY starts_on, created_at`,
    where,
  );
}

export async function orderStatus(h: KycHarness, orderId: string): Promise<{ status: string; membershipId: string | null }> {
  const [row] = await h.select<{ status: string; membershipId: string | null }>(
    'SELECT status, membership_id AS "membershipId" FROM directory.payment_orders WHERE id = :orderId',
    { orderId },
  );
  return row;
}

/** Today in the business time zone, as the ledger computes it. */
export async function today(h: KycHarness): Promise<string> {
  const [row] = await h.select<{ today: string }>(`SELECT (now() AT TIME ZONE 'America/La_Paz')::date::text AS today`);
  return row.today;
}

export async function addDays(h: KycHarness, day: string, days: number): Promise<string> {
  const [row] = await h.select<{ day: string }>('SELECT (CAST(:day AS date) + CAST(:days AS integer))::text AS day', { day, days });
  return row.day;
}
