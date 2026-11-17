import { NotificationService } from '../src/modules/notifications/notification.service';
import { SubscriptionLedgerRepository } from '../src/modules/subscriptions/subscription-ledger.repository';
import { confirm, gymWithLocations, Gym, noticeKeys, socioAt, statusOf } from './support/affiliations-e2e';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { createListing } from './support/listings-e2e';
import { order, removeReceipts } from './support/orders-e2e';
import { GymSeller, addDays, cashOrder, confirmOrder, gymSeller, orderStatus, paidOrder, periodsOf, socioData, today } from './support/subscriptions-e2e';

describe('gym memberships = confirmed SOCIO + marketplace purchase (e2e, franja 8e)', () => {
  let h: KycHarness;
  let gym: GymSeller;
  let otherGym: Gym;

  beforeAll(async () => {
    h = await bootKycHarness();
    gym = await gymSeller(h, 'sub-gym');
    otherGym = await gymWithLocations(h, 'sub-other');
  }, 180000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await removeReceipts(h);
    await h.close();
  });

  const socioOf = async (userId: string, gymId: string) =>
    (await h.select<{ id: string; status: string; ciLast3: string | null }>(
      `SELECT id, status, ci_last3 AS "ciLast3" FROM directory.affiliations WHERE user_id = :userId AND gym_entity_id = :gymId AND kind = 'SOCIO'
        ORDER BY requested_at DESC LIMIT 1`,
      { userId, gymId },
    ))[0];

  it('checkout without affiliation: 422 without the data; with location and CI the order and the REQUESTED SOCIO are born together', async () => {
    const person = await h.e2e.register('sub-new');
    const missing = await h.e2e.as(person.token).post('/directory/payments/orders').send({ listingId: gym.listingId });
    expect([missing.status, missing.body.code, missing.body.details]).toEqual([422, 'AFFILIATION_REQUIRED', { gymEntityId: gym.entityId }]);
    expect(await socioOf(person.id, gym.entityId)).toBeUndefined();
    for (const bad of [{ locationId: gym.locations[0] }, { ...socioData(gym), ciLast3: '12' }, { ...socioData(gym), status: 'CONFIRMED' }]) {
      await h.e2e.as(person.token).post('/directory/payments/orders').send({ listingId: gym.listingId, affiliation: bad }).expect(400);
    }
    const foreignLocation = await h.e2e.as(person.token).post('/directory/payments/orders').send({ listingId: gym.listingId, affiliation: socioData(otherGym) });
    expect([foreignLocation.status, foreignLocation.body.code]).toEqual([400, 'AFFILIATION_LOCATION_INVALID']);
    expect(await h.select('SELECT 1 FROM directory.payment_orders WHERE athlete_user_id = :id', { id: person.id })).toHaveLength(0);

    const created = await order(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    expect(created.status).toBe('PENDING_PAYMENT');
    expect(await socioOf(person.id, gym.entityId)).toMatchObject({ status: 'REQUESTED', ciLast3: '456' });
    expect(await noticeKeys(h, gym.id)).toEqual(expect.arrayContaining([expect.stringMatching(/:requested$/u)]));
  });

  it('a confirmed SOCIO of another gym gets 409 SOCIO_OF_ANOTHER_GYM with the switch action, and no order; switchGym asks the change', async () => {
    const person = await h.e2e.register('sub-switch');
    const elsewhere = await socioAt(h, person.token, otherGym);
    await confirm(h, otherGym, elsewhere).expect(200);
    const refused = await h.e2e.as(person.token).post('/directory/payments/orders').send({ listingId: gym.listingId, affiliation: socioData(gym) });
    expect([refused.status, refused.body.code, refused.body.details]).toEqual([409, 'SOCIO_OF_ANOTHER_GYM', { affiliationId: elsewhere, action: 'SWITCH_GYM' }]);
    expect(await h.select('SELECT 1 FROM directory.payment_orders WHERE athlete_user_id = :id', { id: person.id })).toHaveLength(0);

    const created = await cashOrder(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym, { switchGym: true }) });
    await confirmOrder(h, gym, created.id).expect(200);
    // The new gym confirmed the SOCIO with the payment: the old one ended in the same transaction.
    expect(await statusOf(h, elsewhere)).toMatchObject({ status: 'ENDED', reasonCode: 'SWITCHED_GYM', ciLast3: null });
    expect(await socioOf(person.id, gym.entityId)).toMatchObject({ status: 'CONFIRMED' });
  });

  it('confirming the order confirms the SOCIO and opens a new period in one transaction; a renewal chains after it', async () => {
    const person = await h.e2e.register('sub-confirm');
    const first = await paidOrder(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    const confirmed = await confirmOrder(h, gym, first.id).expect(200);
    expect(confirmed.body.data.status).toBe('CONFIRMED');
    const socio = await socioOf(person.id, gym.entityId);
    expect(socio.status).toBe('CONFIRMED');
    const day = await today(h);
    const [period] = await periodsOf(h, { orderId: first.id });
    expect(period).toMatchObject({ startsOn: day, endsOn: await addDays(h, day, 29), status: 'ACTIVE', origin: 'MARKETPLACE', offerKind: 'MEMBERSHIP', affiliationId: socio.id });
    expect(await orderStatus(h, first.id)).toEqual({ status: 'CONFIRMED', membershipId: period.id });
    const [history] = await h.select<{ count: number; event: string }>(
      `SELECT count(*)::int AS count, max(e.event_name) AS event FROM membership.status_history s JOIN integration.domain_events e ON e.id = s.domain_event_id
        WHERE s.membership_id = :id`,
      { id: period.id },
    );
    expect(history).toEqual({ count: 1, event: 'subscription.period-opened.v1' });
    expect(await noticeKeys(h, person.id)).toEqual(expect.arrayContaining([`affiliation:${socio.id}:confirmed`]));

    // Already SOCIO: the renewal needs no checkout data and starts the day after the running period.
    const renewal = await cashOrder(h, person.token, { listingId: gym.listingId });
    await confirmOrder(h, gym, renewal.id).expect(200);
    const [next] = await periodsOf(h, { orderId: renewal.id });
    expect(next).toMatchObject({ startsOn: await addDays(h, day, 30), endsOn: await addDays(h, day, 59), status: 'ACTIVE' });
    // Never an extension in place: the first period is untouched.
    expect((await periodsOf(h, { orderId: first.id }))[0]).toEqual(period);
  });

  it('nothing is half-done: a gym that cannot confirm the SOCIO, or a period that fails, leaves order and affiliation as they were', async () => {
    const person = await h.e2e.register('sub-atomic');
    const created = await cashOrder(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    await h.e2e.sql(`UPDATE directory.entities SET status = 'SUSPENDED' WHERE id = :id`, { id: gym.entityId });
    try {
      const refused = await confirmOrder(h, gym, created.id);
      expect([refused.status, refused.body.code]).toEqual([409, 'GYM_NOT_ACTIVE']);
      expect(await orderStatus(h, created.id)).toEqual({ status: 'PENDING_VERIFICATION', membershipId: null });
      expect(await periodsOf(h, { userId: person.id })).toEqual([]);
      expect((await socioOf(person.id, gym.entityId)).status).toBe('REQUESTED');
    } finally {
      await h.e2e.sql(`UPDATE directory.entities SET status = 'ACTIVE' WHERE id = :id`, { id: gym.entityId });
    }

    jest.spyOn(h.e2e.app.get(SubscriptionLedgerRepository), 'create').mockRejectedValueOnce(new Error('ledger down'));
    await confirmOrder(h, gym, created.id).expect(500);
    expect(await orderStatus(h, created.id)).toEqual({ status: 'PENDING_VERIFICATION', membershipId: null });
    expect((await socioOf(person.id, gym.entityId)).status).toBe('REQUESTED');

    // A notice that fails is the only thing allowed to be missing: order, SOCIO and period all happen.
    jest.spyOn(h.e2e.app.get(NotificationService), 'enqueueDirectMessage').mockRejectedValue(new Error('notices down'));
    try {
      await confirmOrder(h, gym, created.id).expect(200);
    } finally {
      jest.restoreAllMocks();
    }
    expect((await orderStatus(h, created.id)).status).toBe('CONFIRMED');
    expect((await socioOf(person.id, gym.entityId)).status).toBe('CONFIRMED');
    expect(await periodsOf(h, { orderId: created.id })).toHaveLength(1);
  });

  it('«también confirmo que es socio» unchecked confirms only the payment; the period keeps the pending SOCIO', async () => {
    const person = await h.e2e.register('sub-unchecked');
    const created = await cashOrder(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    await confirmOrder(h, gym, created.id, { alsoConfirmAffiliation: 'no' }).expect(400);
    await confirmOrder(h, gym, created.id, { alsoConfirmAffiliation: false }).expect(200);
    const socio = await socioOf(person.id, gym.entityId);
    expect(socio.status).toBe('REQUESTED');
    expect((await periodsOf(h, { orderId: created.id }))[0].affiliationId).toBe(socio.id);
  });

  it('what was sold is what is opened: no price or validity in the body, and a listing edited after the sale changes nothing', async () => {
    const person = await h.e2e.register('sub-tamper');
    for (const extra of [{ validityDays: 365 }, { startsOn: '2020-01-01' }, { amount: '1.00' }, { affiliation: { ...socioData(gym), status: 'CONFIRMED' } }]) {
      await h.e2e.as(person.token).post('/directory/payments/orders').send({ listingId: gym.listingId, affiliation: socioData(gym), ...extra }).expect(400);
    }
    const created = await cashOrder(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    await h.e2e.as(gym.token).patch(`/business/me/listings/${gym.listingId}`).send({ validityDays: 365 }).expect(200);
    try {
      await confirmOrder(h, gym, created.id, { alsoConfirmAffiliation: true, validityDays: 365 }).expect(400);
      await confirmOrder(h, gym, created.id).expect(200);
      const [period] = await periodsOf(h, { orderId: created.id });
      expect(period.endsOn).toBe(await addDays(h, period.startsOn, 29));
    } finally {
      await h.e2e.as(gym.token).patch(`/business/me/listings/${gym.listingId}`).send({ validityDays: 30 }).expect(200);
    }
  });

  it('a day pass of the gym and a pack need no affiliation and use the same ledger', async () => {
    const person = await h.e2e.register('sub-pass');
    const pass = await createListing(h, gym, { offerKind: 'DAY_PASS', name: 'Pase del día', description: 'Un día de sala.', price: 30 });
    const pack = await createListing(h, gym, { offerKind: 'CLASS_PACK', name: 'Diez clases', description: 'Diez clases de spinning.', price: 200, sessionsCount: 10 });
    const day = await today(h);
    for (const [listingId, expected] of [
      [pass.id, { startsOn: day, endsOn: day, offerKind: 'DAY_PASS', sessionsTotal: null }],
      [pack.id, { startsOn: day, endsOn: null, offerKind: 'CLASS_PACK', sessionsTotal: 10 }],
    ] as const) {
      const created = await cashOrder(h, person.token, { listingId });
      await confirmOrder(h, gym, created.id).expect(200);
      expect((await periodsOf(h, { orderId: created.id }))[0]).toMatchObject({ ...expected, affiliationId: null });
    }
    expect(await socioOf(person.id, gym.entityId)).toBeUndefined();
  });
});
