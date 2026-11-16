import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';

/**
 * Email verification by PIN and the social gate: an unverified account can use
 * everything except the social surface, which answers 403
 * EMAIL_VERIFICATION_REQUIRED until the PIN is confirmed.
 */
describe('email verification (e2e)', () => {
  let e2e: E2eApp;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, 60_000);
  afterAll(async () => {
    await e2e?.app.close();
  });

  const latestPin = async (userId: string): Promise<string> => {
    const rows = await e2e.app.get(Sequelize).query<{ body: string }>(
      `SELECT body FROM notifications.messages
        WHERE recipient_user_id = :userId AND channel = 'EMAIL' AND deduplication_key LIKE 'email-verification-%'
        ORDER BY created_at DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const pin = /(\d{6})/u.exec(rows[0]?.body ?? '')?.[1];
    if (!pin) throw new Error('No verification PIN was enqueued.');
    return pin;
  };

  const signup = async (label: string) => {
    const response = await request(e2e.http)
      .post(e2e.url('/auth/register'))
      .send({
        email: `verify-${label}-${suffix}@example.test`,
        password: 'verify-e2e-password',
        nombreCompleto: `Verify ${label}`,
        ...E2E_SIGNUP_FIELDS,
      })
      .expect(201);
    return { token: response.body.data.accessToken as string, id: response.body.data.user.id as string, body: response.body };
  };

  it('requires a session for both PIN endpoints', async () => {
    await request(e2e.http).post(e2e.url('/auth/email/verify/request')).expect(401);
    await request(e2e.http).post(e2e.url('/auth/email/verify/confirm')).send({ pin: '123456' }).expect(401);
  });

  it('sends the first PIN at signup, gates social routes, and opens them after confirming', async () => {
    const member = await signup('flow');
    const other = await e2e.register('flow-peer');
    const api = e2e.as(member.token);
    expect(member.body.data.user.emailVerified).toBe(false);

    const me = await api.get('/auth/me').expect(200);
    expect(me.body.data.emailVerified).toBe(false);

    // Social: closed with a stable code. Own data and non-social features: open.
    const blocked = await api.post('/me/connections').send({ addresseeId: other.id }).expect(403);
    expect(blocked.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect((await api.get('/me/discovery/deck').expect(403)).body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect((await api.post('/me/stories').expect(403)).body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect((await api.get('/me/interactions/counts').expect(403)).body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    await api.get('/me/connections').expect(200);
    await api.get('/me/social-profile').expect(200);
    await api.get('/me/devices').expect(200);
    const readiness = await api.get('/me/discovery/readiness').expect(200);
    expect(readiness.body.data.missing[0]).toBe('EMAIL_VERIFICATION');

    // The signup PIN is still in its cooldown window.
    const cooldown = await api.post('/auth/email/verify/request').expect(429);
    expect(cooldown.body.code).toBe('EMAIL_PIN_COOLDOWN');
    expect(cooldown.body.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(cooldown.body.details.retryAfterSeconds).toBeLessThanOrEqual(60);

    const pin = await latestPin(member.id);
    const wrong = pin === '000000' ? '111111' : '000000';
    const invalid = await api.post('/auth/email/verify/confirm').send({ pin: wrong }).expect(400);
    expect(invalid.body.code).toBe('EMAIL_PIN_INVALID');
    expect(invalid.body.details.attemptsRemaining).toBe(4);
    await api.post('/auth/email/verify/confirm').send({ pin: '12' }).expect(400);

    await expect(api.post('/auth/email/verify/confirm').send({ pin }).expect(200)).resolves.toMatchObject({
      body: { data: { verified: true } },
    });
    // Persisted: a reload sees it, and the social gate is open now.
    expect((await api.get('/auth/me').expect(200)).body.data.emailVerified).toBe(true);
    const connection = await api.post('/me/connections').send({ addresseeId: other.id });
    expect(connection.status).not.toBe(403);
    const after = await api.get('/me/discovery/readiness').expect(200);
    expect(after.body.data.missing).not.toContain('EMAIL_VERIFICATION');
    // Idempotent, and a verified account gets no new PIN.
    await api.post('/auth/email/verify/confirm').send({ pin }).expect(200);
    await api.post('/auth/email/verify/request').expect(202);
  });

  it('burns the PIN after five wrong attempts and reports an expired one', async () => {
    const member = await signup('burn');
    const api = e2e.as(member.token);
    const pin = await latestPin(member.id);
    const wrong = pin === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await api.post('/auth/email/verify/confirm').send({ pin: wrong }).expect(400)).body.code).toBe(
        'EMAIL_PIN_INVALID',
      );
    }
    expect((await api.post('/auth/email/verify/confirm').send({ pin: wrong }).expect(400)).body.code).toBe(
      'EMAIL_PIN_EXHAUSTED',
    );
    // Even the right digits no longer work for that PIN.
    expect((await api.post('/auth/email/verify/confirm').send({ pin }).expect(400)).body.code).toBe('EMAIL_PIN_EXHAUSTED');

    // Past the cooldown a new PIN is issued; once its time is up it is EXPIRED.
    await e2e.sql(
      `UPDATE auth.email_verification_pins SET created_at = created_at - interval '2 minutes' WHERE user_id = :userId`,
      { userId: member.id },
    );
    await api.post('/auth/email/verify/request').expect(202);
    const fresh = await latestPin(member.id);
    await e2e.sql(
      `UPDATE auth.email_verification_pins SET expires_at = now() - interval '1 second'
        WHERE user_id = :userId AND consumed_at IS NULL`,
      { userId: member.id },
    );
    expect((await api.post('/auth/email/verify/confirm').send({ pin: fresh }).expect(400)).body.code).toBe(
      'EMAIL_PIN_EXPIRED',
    );
    expect((await api.get('/auth/me').expect(200)).body.data.emailVerified).toBe(false);
  });

  it('caps the PIN sends per account and day', async () => {
    const member = await signup('cap');
    const api = e2e.as(member.token);
    for (let sent = 1; sent < 5; sent += 1) {
      await e2e.sql(
        `UPDATE auth.email_verification_pins SET created_at = created_at - interval '2 minutes' WHERE user_id = :userId`,
        { userId: member.id },
      );
      await api.post('/auth/email/verify/request').expect(202);
    }
    await e2e.sql(
      `UPDATE auth.email_verification_pins SET created_at = created_at - interval '2 minutes' WHERE user_id = :userId`,
      { userId: member.id },
    );
    const capped = await api.post('/auth/email/verify/request').expect(429);
    expect(capped.body.code).toBe('EMAIL_PIN_COOLDOWN');
    expect(capped.body.details.retryAfterSeconds).toBeGreaterThan(60);
  });

  it('rejects a signup that trips the honeypot with a generic code and no account', async () => {
    const email = `verify-bot-${suffix}@example.test`;
    const rejected = await request(e2e.http)
      .post(e2e.url('/auth/register'))
      .send({ email, password: 'verify-e2e-password', nombreCompleto: 'Bot', website: 'http://spam.example', ...E2E_SIGNUP_FIELDS })
      .expect(400);
    expect(rejected.body.code).toBe('SIGNUP_REJECTED');
    expect(JSON.stringify(rejected.body)).not.toMatch(/HONEYPOT/u);
    const rows = await e2e.app.get(Sequelize).query('SELECT 1 FROM public.usuarios WHERE email = :email', {
      type: QueryTypes.SELECT,
      replacements: { email },
    });
    expect(rows).toHaveLength(0);
  });
});
