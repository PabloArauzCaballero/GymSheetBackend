import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { hashEmail } from '../src/common/privacy/email-hash';
import { env } from '../src/config/env';
import { AccountClosureService } from '../src/modules/account/account-closure.service';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';

const PASSWORD = 'e2e-strong-password';
const DAY_MS = 86_400_000;

/** Ban evasion through account closure (ADR-0015): closing must not wipe a sanction. */
describe('Account closure keeps moderation sanctions (e2e)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;
  const secret = 'e2e-privacy-pepper-closure-sanctions-0123456789';
  const config = env as { IP_HASH_SECRET?: string };
  const original = config.IP_HASH_SECRET;

  beforeAll(async () => {
    config.IP_HASH_SECRET = secret;
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
    if (original === undefined) delete config.IP_HASH_SECRET;
    else config.IP_HASH_SECRET = original;
  });

  const rows = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
    sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });
  const emailOf = async (id: string) =>
    (await rows<{ email: string }>('SELECT email FROM public.usuarios WHERE id = :id', { id }))[0].email;
  const records = (email: string) =>
    rows<{ strike_count: number; suspended_until: Date | null; expires_at: Date }>(
      'SELECT strike_count, suspended_until, expires_at FROM moderation.closed_account_sanctions WHERE email_hmac = :h',
      { h: hashEmail(email, secret) });
  const addStrike = (userId: string, kind: string, expiresInDays: number, suspendedUntil: Date | null) =>
    e2e.sql(`INSERT INTO moderation.user_strikes (id, user_id, tenant_id, kind, reason, expires_at, suspended_until)
      SELECT uuid_generate_v4(), u.id, COALESCE(u.tenant_id, (SELECT id FROM public.tenants ORDER BY id LIMIT 1)),
             :kind, 'SPAM', :expiresAt, :suspendedUntil FROM public.usuarios u WHERE u.id = :userId`,
    { userId, kind, expiresAt: new Date(Date.now() + expiresInDays * DAY_MS), suspendedUntil });
  const signUp = async (email: string) => {
    const ticket = await request(e2e.http).get(e2e.url('/auth/register/ticket')).expect(200);
    return request(e2e.http).post(e2e.url('/auth/register')).send({
      ticket: ticket.body.data.ticket as string, email, password: PASSWORD, nombreCompleto: 'Vuelvo', ...E2E_SIGNUP_FIELDS,
    });
  };
  const accountByEmail = async (email: string) =>
    (await rows<{ id: string; suspended_until: Date | null }>(
      'SELECT id, suspended_until FROM public.usuarios WHERE email = :email', { email }))[0];
  const activeStrikes = async (userId: string) =>
    (await rows<{ expires_at: Date }>(
      'SELECT expires_at FROM moderation.user_strikes WHERE user_id = :userId AND expires_at > now() ORDER BY expires_at',
      { userId })).map((row) => row.expires_at.toISOString());

  it('a warned member who closes and signs up again keeps the strikes', async () => {
    const member = await e2e.register('sanction-strikes');
    const email = await emailOf(member.id);
    await addStrike(member.id, 'ADVERTENCIA', 300, null);
    await addStrike(member.id, 'SUSPENSION', 200, new Date(Date.now() - DAY_MS));
    const before = await activeStrikes(member.id);

    await e2e.as(member.token).del('/me/account').send({ password: PASSWORD }).expect(200);
    expect(await records(email)).toEqual([expect.objectContaining({ strike_count: 2, suspended_until: null })]);

    await signUp(email).then((response) => expect(response.status).toBe(201));
    const reborn = await accountByEmail(email);
    expect(reborn.id).not.toBe(member.id);
    expect(reborn.suspended_until).toBeNull();
    expect(await activeStrikes(reborn.id)).toEqual(before);
    expect(await records(email)).toEqual([]);
  });

  it('a suspended member who closes and signs up again is still suspended', async () => {
    const member = await e2e.register('sanction-suspended');
    const email = await emailOf(member.id);
    const until = new Date(Date.now() + 3 * DAY_MS);
    await addStrike(member.id, 'SUSPENSION', 365, until);
    await e2e.sql('UPDATE public.usuarios SET suspended_until = :until WHERE id = :id', { until, id: member.id });
    // A suspended session is refused by the JWT guard, so the closure runs at service level.
    await e2e.app.get(AccountClosureService).close(member.id, { password: PASSWORD });
    expect(await records(email)).toHaveLength(1);

    const refused = await signUp(email);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain('suspendida');
    const reborn = await accountByEmail(email);
    expect(reborn.suspended_until?.getTime()).toBe(until.getTime());
    expect(await activeStrikes(reborn.id)).toHaveLength(1);
    const login = await request(e2e.http).post(e2e.url('/auth/login')).send({ email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(await records(email)).toEqual([]);
  });

  it('an unsanctioned closure leaves no record and the next signup starts clean', async () => {
    const member = await e2e.register('sanction-clean');
    const email = await emailOf(member.id);
    await e2e.as(member.token).del('/me/account').send({ password: PASSWORD }).expect(200);
    expect(await records(email)).toEqual([]);
    await signUp(email).then((response) => expect(response.status).toBe(201));
    expect(await activeStrikes((await accountByEmail(email)).id)).toEqual([]);
  });
});
