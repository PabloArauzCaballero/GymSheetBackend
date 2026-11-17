import request from 'supertest';
import { BUSINESS_CLOSURE_STEPS } from '../src/modules/business-closure/business-closure.catalog';
import { publishedCoach } from './support/affiliations-e2e';
import { KycBusiness, KycHarness, bootKycHarness, randomDigits } from './support/kyc-e2e';
import { publicGet } from './support/listings-e2e';
import { order, removeReceipts } from './support/orders-e2e';
import { GymSeller, confirmOrder, gymSeller, paidOrder, periodsOf, socioData } from './support/subscriptions-e2e';

const PASSWORD = 'e2e-strong-password';
type Person = { token: string; id: string };

describe('a business account closes itself (e2e, franja 8f, ADR-0028)', () => {
  let h: KycHarness;
  let gym: GymSeller;
  let coach: KycBusiness;
  let member: Person;
  let unpaid: Person;
  let payer: Person;
  const ids: Record<string, string> = {};

  const one = async <T extends object>(sql: string, replacements: Record<string, unknown>) => (await h.select<T>(sql, replacements))[0];
  const noticeKeysOf = async (userId: string) =>
    (await h.select<{ key: string }>('SELECT deduplication_key AS key FROM notifications.messages WHERE recipient_user_id = :userId', { userId })).map((row) => row.key);

  beforeAll(async () => {
    h = await bootKycHarness();
    gym = await gymSeller(h, 'close-gym');
    coach = await publishedCoach(h, 'close-coach');
    [member, unpaid, payer] = [await h.e2e.register('close-member'), await h.e2e.register('close-unpaid'), await h.e2e.register('close-payer')];
    // A member with a confirmed SOCIO and a running period.
    const paid = await paidOrder(h, member.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    await confirmOrder(h, gym, paid.id).expect(200);
    ids.paidOrder = paid.id;
    ids.period = (await periodsOf(h, { orderId: paid.id }))[0].id;
    // A buyer who has not paid yet (and so asked to be SOCIO), and one whose receipt waits for the gym.
    ids.unpaidOrder = (await order(h, unpaid.token, { listingId: gym.listingId, affiliation: socioData(gym) })).id;
    ids.waitingOrder = (await paidOrder(h, payer.token, { listingId: gym.listingId, affiliation: socioData(gym) })).id;
    // A coach linked to the gym.
    ids.coachLink = (await h.e2e.as(coach.token).post('/business/me/gym-links').send({ gymHandle: `@${gym.handle}` }).expect(201)).body.data.id;
    await h.e2e.as(gym.token).post(`/business/me/affiliations/${ids.coachLink}/confirm`).expect(200);
    // The unpaid buyer writes to the gym; the gym answers.
    ids.conversation = (await h.e2e.as(unpaid.token).post('/me/business-conversations').send({ entityId: gym.entityId }).expect(201)).body.data.conversationId;
    await h.e2e.as(unpaid.token).post(`/me/conversations/${ids.conversation}/messages`).send({ body: '¿Puedo pagar mañana?' }).expect(201);
    await h.e2e.as(gym.token).post(`/me/conversations/${ids.conversation}/messages`).send({ body: 'Sí, te esperamos.' }).expect(201);
  }, 240000);

  afterAll(async () => {
    await removeReceipts(h);
    await h.close();
  });

  it('refuses with 409 BUSINESS_HAS_PENDING_VERIFICATIONS while a receipt waits, says so in the preview and changes nothing', async () => {
    const preview = (await h.e2e.as(gym.token).get('/me/account/closure-preview').expect(200)).body.data;
    expect(preview).toMatchObject({ allowed: true, blockers: [{ code: 'BUSINESS_HAS_PENDING_VERIFICATIONS', count: 1 }], account: { label: 'Tu cuenta de negocio' } });
    expect(preview.anonymized.map((item: { label: string }) => item.label)).toEqual(
      expect.arrayContaining(['Pedidos sin pagar o con el pago observado', 'Socios y coaches vinculados', 'Suscripciones en curso o por empezar', 'Tu @usuario']),
    );
    const refused = await h.e2e.as(gym.token).del('/me/account').send({ password: PASSWORD });
    expect([refused.status, refused.body.code, refused.body.details?.count]).toEqual([409, 'BUSINESS_HAS_PENDING_VERIFICATIONS', 1]);
    expect(await one<{ status: string }>('SELECT status FROM directory.entities WHERE id = :id', { id: gym.entityId })).toEqual({ status: 'ACTIVE' });
    // Renaming the account is not the way a business changes its name.
    await h.e2e.as(gym.token).patch('/me/account').send({ nombreCompleto: 'Otro nombre' }).expect(403);
  });

  it('closes once the receipt is decided: listing CLOSED, listings archived, payment data gone, the session ends', async () => {
    await h.e2e.as(gym.token).post(`/business/me/orders/${ids.waitingOrder}/reject`).send({ reasonCode: 'NOT_RECEIVED' }).expect(200);
    expect((await h.e2e.as(gym.token).get('/me/account/closure-preview').expect(200)).body.data.blockers).toEqual([]);
    await h.e2e.as(gym.token).del('/me/account').send({ password: PASSWORD }).expect(200);

    expect(await one('SELECT e.status, e.is_verified AS verified, e.logo_url AS logo, a.status AS account FROM directory.entities e JOIN business.accounts a ON a.entity_id = e.id WHERE e.id = :id', { id: gym.entityId }))
      .toEqual({ status: 'CLOSED', verified: false, logo: null, account: 'CLOSED' });
    expect(await h.select('SELECT DISTINCT status FROM directory.entity_plans WHERE entity_id = :id', { id: gym.entityId })).toEqual([{ status: 'ARCHIVED' }]);
    expect(await h.select('SELECT 1 FROM directory.entity_payment_configs WHERE entity_id = :id', { id: gym.entityId })).toHaveLength(0);
    await publicGet(h, `/public/directory/listings/${gym.listingId}`).expect(404);
    await publicGet(h, `/public/directory/profiles/${gym.handle}`).expect(404);
    await h.e2e.as(gym.token).get('/business/me').expect(401);
  });

  it('retires the handle without redirect and nobody can take it for 180 days', async () => {
    const handle = await one<{ status: string; redirect: string | null; days: number }>(
      `SELECT status, redirect_to_handle AS redirect, round(extract(epoch FROM locked_until - now()) / 86400)::int AS days FROM directory.handles WHERE handle = :handle`,
      { handle: gym.handle },
    );
    expect(handle).toEqual({ status: 'RETIRED', redirect: null, days: 180 });
    const squatter = await h.business('close-squat');
    const taken = await h.e2e.as(squatter.token).put('/business/me/handle').send({ handle: gym.handle });
    expect([taken.status, taken.body.code]).toEqual([409, 'HANDLE_TAKEN']);
    // Past the lock (clock moved in the row), the name is free again.
    await h.e2e.sql(`UPDATE directory.handles SET locked_until = now() - interval '1 minute' WHERE handle = :handle`, { handle: gym.handle });
    await h.e2e.as(squatter.token).put('/business/me/handle').send({ handle: gym.handle }).expect(200);
  });

  it('cancels the unpaid and the observed orders with a notice, and keeps the paid one for the buyer without the business account', async () => {
    for (const [id, buyer] of [[ids.unpaidOrder, unpaid], [ids.waitingOrder, payer]] as const) {
      expect(await one('SELECT status, cancel_reason AS reason FROM directory.payment_orders WHERE id = :id', { id })).toEqual({ status: 'CANCELLED', reason: 'BUSINESS_CLOSED' });
      expect(await noticeKeysOf(buyer.id)).toContain(`payment-order:${id}:business-closed`);
    }
    expect(await one('SELECT status, decided_by_user_id AS decider FROM directory.payment_orders WHERE id = :id', { id: ids.paidOrder })).toEqual({ status: 'CONFIRMED', decider: null });
    const mine = (await h.e2e.as(member.token).get(`/directory/payments/orders/${ids.paidOrder}`).expect(200)).body.data;
    expect(mine).toMatchObject({ status: 'CONFIRMED', seller: { entityId: gym.entityId, name: gym.name } });
  });

  it('ends the affiliations (members and the coach, told why) and cancels the running period with its history', async () => {
    const socios = await h.select<{ user: string; status: string; reason: string; ci: string | null }>(
      `SELECT user_id AS user, status, reason_code AS reason, ci_last3 AS ci FROM directory.affiliations WHERE gym_entity_id = :id AND user_id IS NOT NULL ORDER BY user_id`,
      { id: gym.entityId },
    );
    expect(socios.find((row) => row.user === member.id)).toEqual({ user: member.id, status: 'ENDED', reason: 'BUSINESS_CLOSED', ci: null });
    expect(socios.find((row) => row.user === unpaid.id)).toMatchObject({ status: 'CANCELLED', reason: 'BUSINESS_CLOSED' });
    expect(await one('SELECT status, reason_code AS reason FROM directory.affiliations WHERE id = :id', { id: ids.coachLink })).toEqual({ status: 'ENDED', reason: 'BUSINESS_CLOSED' });
    expect(await noticeKeysOf(coach.id)).toContain(`affiliation:${ids.coachLink}:business-closed`);
    expect((await noticeKeysOf(member.id)).filter((key) => key.endsWith(':business-closed'))).toHaveLength(2);

    expect(await one('SELECT status FROM membership.memberships WHERE id = :id', { id: ids.period })).toEqual({ status: 'CANCELLED' });
    expect(await h.select('SELECT from_status AS "from", to_status AS "to", reason FROM membership.status_history WHERE membership_id = :id AND reason = :reason', { id: ids.period, reason: 'BUSINESS_CLOSED' }))
      .toEqual([{ from: 'ACTIVE', to: 'CANCELLED', reason: 'BUSINESS_CLOSED' }]);
    expect(await noticeKeysOf(member.id)).toContain(`subscription:${ids.period}:business-closed`);
  });

  it('leaves the conversation read-only for the person, «Negocio cerrado», with the business messages kept', async () => {
    const items = (await h.e2e.as(unpaid.token).get('/me/conversations').expect(200)).body.data as { conversationId: string; businessClosed: boolean; canWrite: boolean; otherUserName: string }[];
    expect(items.find((item) => item.conversationId === ids.conversation)).toMatchObject({ businessClosed: true, canWrite: false, otherUserName: gym.name });
    await h.e2e.as(unpaid.token).post(`/me/conversations/${ids.conversation}/messages`).send({ body: '¿Hola?' }).expect(403);
    const kept = await h.select<{ body: string }>('SELECT body FROM chat.messages WHERE conversation_id = :id AND sender_id = :gym AND deleted_at IS NULL', { id: ids.conversation, gym: gym.id });
    expect(kept).toEqual([{ body: 'Sí, te esperamos.' }]);
    await h.e2e.as(unpaid.token).post('/me/business-conversations').send({ entityId: gym.entityId }).expect(404);
  });

  it('covers in the business catalogue every table where the closed business account still had rows', async () => {
    const references = await h.select<{ table: string; column: string }>(
      `SELECT n.nspname || '.' || c.relname AS table, a.attname AS column
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND con.confrelid IN ('public.usuarios'::regclass, 'business.accounts'::regclass, 'directory.entities'::regclass)
          AND array_length(con.conkey, 1) = 1`,
    );
    const covered = new Set(BUSINESS_CLOSURE_STEPS.map((step) => step.table));
    const uncovered: string[] = [];
    for (const { table, column } of references) {
      if (covered.has(table)) continue;
      const [row] = await h.select<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} IN (:user, :entity)`, { user: gym.id, entity: gym.entityId });
      if (row.count > 0) uncovered.push(`${table}.${column}`);
    }
    expect(uncovered).toEqual([]);
  });

  it('a business REPP suspended leaves its NIT and CI behind: a new business with them goes to review', async () => {
    const nit = randomDigits(10);
    const ci = randomDigits(7);
    const first = await publishedBusinessWith(h, 'close-fraud', nit, ci);
    await h.e2e.sql(`UPDATE business.accounts SET status = 'SUSPENDED' WHERE user_id = :id`, { id: first.id });
    await h.e2e.as(first.token).del('/me/account').send({ password: PASSWORD }).expect(200);
    const [trace] = await h.select<{ suspended: boolean; nits: number; cis: number }>(
      `SELECT business_suspended AS suspended, cardinality(nit_hmacs) AS nits, cardinality(ci_hmacs) AS cis FROM moderation.closed_account_sanctions ORDER BY created_at DESC LIMIT 1`,
    );
    expect(trace).toEqual({ suspended: true, nits: 1, cis: 1 });

    const again = await h.ready('close-reborn', { nit, ci });
    const submit = await h.e2e.as(again.token).post('/business/me/kyc/submit').expect(200);
    expect(submit.body.data.status).toBe('IN_REVIEW');
    expect(await h.select(`SELECT outcome FROM business.kyc_checks c JOIN business.kyc_submissions s ON s.id = c.submission_id
                            WHERE s.account_id = :id AND c.code = 'CLOSED_ACCOUNT_SANCTION'`, { id: again.id })).toEqual([{ outcome: 'FAIL' }]);
  });

  it('a person cannot reach a business closure, and a request without a token is 401', async () => {
    await request(h.e2e.http).delete(h.e2e.url('/me/account')).send({ password: PASSWORD }).expect(401);
    await h.e2e.as(member.token).get('/business/me/orders').expect(403);
  });
});

async function publishedBusinessWith(h: KycHarness, label: string, nit: string, ci: string): Promise<KycBusiness> {
  const owner = await h.ready(label, { nit, ci });
  const submit = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
  if (submit.body.data.status !== 'AUTO_APPROVED') throw new Error(`KYC ${submit.body.data.status}`);
  return owner;
}
