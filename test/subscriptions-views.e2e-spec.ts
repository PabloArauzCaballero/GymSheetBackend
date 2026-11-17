import { randomUUID } from 'node:crypto';
import { MembershipReminderService } from '../src/modules/notifications/membership-reminder.service';
import { NotificationRepository } from '../src/modules/notifications/notification.repository';
import { REMINDER_DAYS } from '../src/modules/subscriptions/subscription.catalog';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { order, removeReceipts } from './support/orders-e2e';
import { GymSeller, addDays, cashOrder, confirmOrder, gymSeller, periodsOf, socioData, today } from './support/subscriptions-e2e';

describe('«Mis suscripciones» and the business «Suscriptores» (e2e, franja 8e)', () => {
  let h: KycHarness;
  let gym: GymSeller;
  let rival: GymSeller;
  let member: { token: string; id: string };
  let stranger: { token: string; id: string };
  let periodId: string;

  beforeAll(async () => {
    h = await bootKycHarness();
    gym = await gymSeller(h, 'subv-gym');
    rival = await gymSeller(h, 'subv-rival');
    member = await h.e2e.register('subv-member');
    stranger = await h.e2e.register('subv-stranger');
    const created = await cashOrder(h, member.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    await confirmOrder(h, gym, created.id).expect(200);
    periodId = (await periodsOf(h, { orderId: created.id }))[0].id;
  }, 180000);

  afterAll(async () => {
    await removeReceipts(h);
    await h.close();
  });

  it('the person sees her periods grouped by seller, with the SOCIO status, the renewal target and a pending order', async () => {
    await order(h, member.token, { listingId: rival.listingId, affiliation: socioData(rival, { switchGym: true }) });
    const body = (await h.e2e.as(member.token).get('/me/subscriptions').expect(200)).body.data;
    const day = await today(h);
    expect(body.today).toBe(day);
    const mine = body.items.find((group: { seller: { entityId: string } }) => group.seller?.entityId === gym.entityId);
    expect(Object.keys(mine).sort()).toEqual(['affiliation', 'seller', 'subscriptions']);
    expect(mine.seller).toMatchObject({ name: gym.name, handle: gym.handle, entityType: 'GYM' });
    expect(mine.affiliation).toMatchObject({ status: 'CONFIRMED' });
    expect(mine.subscriptions).toEqual([
      {
        listing: { id: gym.listingId, name: expect.any(String), offerKind: 'MEMBERSHIP' },
        status: 'ACTIVE',
        current: { id: periodId, status: 'ACTIVE', startsOn: day, endsOn: await addDays(h, day, 29), daysLeft: 29, sessions: null, origin: 'MARKETPLACE' },
        upcoming: null,
        pendingOrder: null,
        renew: { listingId: gym.listingId, available: true },
      },
    ]);
    // The rival gym: a first purchase waiting for payment and the «cambio de gimnasio» it asked.
    const pending = body.items.find((group: { seller: { entityId: string } }) => group.seller?.entityId === rival.entityId);
    expect(pending.affiliation).toMatchObject({ status: 'REQUESTED' });
    expect(pending.subscriptions).toEqual([expect.objectContaining({ status: 'PENDING', current: null, pendingOrder: expect.objectContaining({ status: 'PENDING_PAYMENT' }) })]);

    const detail = (await h.e2e.as(member.token).get(`/me/subscriptions/${periodId}`).expect(200)).body.data;
    expect(detail).toMatchObject({ id: periodId, status: 'ACTIVE', seller: { entityId: gym.entityId }, history: [{ fromStatus: null, toStatus: 'ACTIVE', reasonCode: null }] });
    expect(JSON.stringify(detail)).not.toContain(gym.id);
  });

  it('nobody else reads a period: another person gets 404 and an empty list; a business account gets 403', async () => {
    await h.e2e.as(stranger.token).get(`/me/subscriptions/${periodId}`).expect(404);
    expect((await h.e2e.as(stranger.token).get('/me/subscriptions').expect(200)).body.data.items).toEqual([]);
    const asBusiness = await h.e2e.as(gym.token).get('/me/subscriptions');
    expect([asBusiness.status, asBusiness.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
  });

  it('the business lists its subscribers with the expiry and the last payment; «por vencer» and «vencidos» filter them', async () => {
    const body = (await h.e2e.as(gym.token).get('/business/me/subscriptions').expect(200)).body.data;
    const row = body.items.find((item: { id: string }) => item.id === periodId);
    expect(Object.keys(row).sort()).toEqual(
      ['actions', 'affiliation', 'daysLeft', 'endsOn', 'id', 'lastPayment', 'listing', 'origin', 'sessions', 'startsOn', 'status', 'subscriber'].sort(),
    );
    expect(row.subscriber).toEqual({ displayName: expect.any(String) });
    expect(row.lastPayment).toMatchObject({ amount: '250.00', currency: 'BOB', method: 'CASH' });
    expect(row.affiliation).toMatchObject({ status: 'CONFIRMED', location: expect.any(String) });
    expect(row.actions).toEqual({ canCancel: true, canSuspend: true, canReactivate: false });
    const raw = JSON.stringify(body);
    const [{ email }] = await h.select<{ email: string }>('SELECT email FROM public.usuarios WHERE id = :id', { id: member.id });
    expect(raw).not.toContain(email);
    expect(raw).not.toContain(member.id);

    const ids = async (status: string) =>
      ((await h.e2e.as(gym.token).get(`/business/me/subscriptions?status=${status}`).expect(200)).body.data.items as { id: string }[]).map((item) => item.id);
    expect(await ids('EXPIRING')).not.toContain(periodId);
    await h.e2e.sql(`UPDATE membership.memberships SET ends_on = (now() AT TIME ZONE 'America/La_Paz')::date + 3 WHERE id = :id`, { id: periodId });
    expect(await ids('EXPIRING')).toContain(periodId);
    await h.e2e.sql(
      `UPDATE membership.memberships SET starts_on = (now() AT TIME ZONE 'America/La_Paz')::date - 40, ends_on = (now() AT TIME ZONE 'America/La_Paz')::date - 1 WHERE id = :id`,
      { id: periodId },
    );
    expect(await ids('EXPIRED')).toContain(periodId);
    expect(await ids('ACTIVE')).not.toContain(periodId);
    await h.e2e.sql(
      `UPDATE membership.memberships SET starts_on = (now() AT TIME ZONE 'America/La_Paz')::date, ends_on = (now() AT TIME ZONE 'America/La_Paz')::date + 29 WHERE id = :id`,
      { id: periodId },
    );
    await h.e2e.as(gym.token).get('/business/me/subscriptions?cursor=bm9wZQ').expect(400);
  });

  it("another business never sees or touches a subscriber: absent from its list, 404 by id; a person or the platform admin gets 403", async () => {
    const theirs = ((await h.e2e.as(rival.token).get('/business/me/subscriptions').expect(200)).body.data.items as { id: string }[]).map((item) => item.id);
    expect(theirs).not.toContain(periodId);
    await h.e2e.as(rival.token).get(`/business/me/subscriptions/${periodId}`).expect(404);
    await h.e2e.as(rival.token).post(`/business/me/subscriptions/${periodId}/cancel`).send({ reasonCode: 'BUYER_REQUEST' }).expect(404);
    await h.e2e.as(rival.token).post(`/business/me/subscriptions/${periodId}/suspend`).send({ reasonCode: 'CONDUCT' }).expect(404);
    const platform = await h.e2e.platformAdmin('subv-platform');
    for (const token of [member.token, platform.token]) {
      const refused = await h.e2e.as(token).get('/business/me/subscriptions');
      expect(refused.status).toBe(403);
    }
    expect((await periodsOf(h, { userId: member.id }))[0].status).toBe('ACTIVE');
  });

  it('a legacy period attributed to the gym is never shown to its business, nor changed by it', async () => {
    const plan = randomUUID();
    const legacy = randomUUID();
    await h.e2e.sql(`INSERT INTO retired.membership_plans (id, code, name, duration_days) VALUES (:plan, :code, 'Plan del mostrador', 30)`, {
      plan,
      code: `legacy-${plan.slice(0, 8)}`,
    });
    await h.e2e.sql(
      `INSERT INTO membership.memberships (id, user_id, retired_plan_id, entity_id, starts_on, ends_on, offer_kind, plan_name)
       VALUES (:id, :userId, :plan, :entityId, (now() AT TIME ZONE 'America/La_Paz')::date, (now() AT TIME ZONE 'America/La_Paz')::date + 10,
               'MEMBERSHIP', 'Plan del mostrador')`,
      { id: legacy, userId: stranger.id, plan, entityId: gym.entityId },
    );
    const listed = ((await h.e2e.as(gym.token).get('/business/me/subscriptions').expect(200)).body.data.items as { id: string }[]).map((item) => item.id);
    expect(listed).not.toContain(legacy);
    await h.e2e.as(gym.token).get(`/business/me/subscriptions/${legacy}`).expect(404);
    await h.e2e.as(gym.token).post(`/business/me/subscriptions/${legacy}/cancel`).send({ reasonCode: 'BUYER_REQUEST' }).expect(404);
    // Its holder still reads it as hers.
    const own = (await h.e2e.as(stranger.token).get(`/me/subscriptions/${legacy}`).expect(200)).body.data;
    expect(own).toMatchObject({ origin: 'LEGACY', status: 'ACTIVE', listing: { id: null, name: 'Plan del mostrador' } });
  });

  it('the business suspends, reactivates and cancels with a reason; each change leaves history and a notice; cancelled is final', async () => {
    const path = `/business/me/subscriptions/${periodId}`;
    const other = await h.e2e.as(gym.token).post(`${path}/suspend`).send({ reasonCode: 'OTHER' });
    expect([other.status, other.body.code]).toEqual([422, 'SUBSCRIPTION_NOTE_REQUIRED']);
    await h.e2e.as(gym.token).post(`${path}/suspend`).send({ reasonCode: 'HEALTH', startsOn: '2020-01-01' }).expect(400);
    const suspended = (await h.e2e.as(gym.token).post(`${path}/suspend`).send({ reasonCode: 'HEALTH' }).expect(200)).body.data;
    expect(suspended).toMatchObject({ status: 'SUSPENDED', actions: { canCancel: true, canSuspend: false, canReactivate: true } });
    await h.e2e.as(gym.token).post(`${path}/suspend`).send({ reasonCode: 'HEALTH' }).expect(409);
    expect((await h.e2e.as(gym.token).post(`${path}/reactivate`).expect(200)).body.data.status).toBe('ACTIVE');
    const cancelled = await h.e2e.as(gym.token).post(`${path}/cancel`).send({ reasonCode: 'OTHER', note: 'Se mudó de ciudad' }).expect(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', actions: { canCancel: false, canSuspend: false, canReactivate: false } });
    const replay = await h.e2e.as(gym.token).post(`${path}/reactivate`);
    expect([replay.status, replay.body.code]).toEqual([409, 'SUBSCRIPTION_INVALID_TRANSITION']);

    const history = (await h.e2e.as(member.token).get(`/me/subscriptions/${periodId}`).expect(200)).body.data.history as { toStatus: string; reasonCode: string | null }[];
    expect(history.map((step) => `${step.toStatus}:${step.reasonCode ?? ''}`)).toEqual(['ACTIVE:', 'SUSPENDED:HEALTH', 'ACTIVE:', 'CANCELLED:OTHER']);
    const notices = await h.select<{ key: string }>(
      `SELECT deduplication_key AS key FROM notifications.messages WHERE recipient_user_id = :id AND deduplication_key LIKE 'subscription:%' ORDER BY created_at`,
      { id: member.id },
    );
    expect(notices.map((row) => row.key.split(':')[2])).toEqual(['suspended', 'reactivated', 'cancelled']);
  });

  it('the reminder worker reads the ledger: a period ending in 7 days is reminded once, a renewed one is not', async () => {
    const person = await h.e2e.register('subv-reminder');
    const created = await cashOrder(h, person.token, { listingId: rival.listingId, affiliation: socioData(rival) });
    await confirmOrder(h, rival, created.id).expect(200);
    const [period] = await periodsOf(h, { orderId: created.id });
    await h.e2e.sql(`UPDATE membership.memberships SET ends_on = (now() AT TIME ZONE 'America/La_Paz')::date + 7 WHERE id = :id`, { id: period.id });
    const reminders = h.e2e.app.get(MembershipReminderService);
    await reminders.scan(500);
    await reminders.scan(500);
    const sent = await h.select<{ body: string }>(
      `SELECT body FROM notifications.messages WHERE membership_id = :id AND deduplication_key LIKE 'membership-expiry:%'`,
      { id: period.id },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain(rival.name);

    const candidates = async () =>
      (await h.e2e.app.get(NotificationRepository).findExpiringMemberships(await today(h), REMINDER_DAYS, 500)).map((row) => row.membershipId);
    expect(await candidates()).toContain(period.id);
    const renewal = await cashOrder(h, person.token, { listingId: rival.listingId });
    await confirmOrder(h, rival, renewal.id).expect(200);
    expect(await candidates()).not.toContain(period.id);
  });
});
