import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';
import { ANTIBOT_CONFIG, ANTIBOT_FETCH, antibotConfigFromEnv } from '../src/modules/antibot/antibot.config';
import { E2E_SIGNUP_FIELDS } from './support/e2e-app';

/**
 * The signup anti-bot layer through the real HTTP stack and PostgreSQL. The
 * e2e environment disables ticket enforcement for legacy suites; this suite
 * turns every no-account layer back on, plus Turnstile behind a fake
 * Cloudflare (the only network double: nothing leaves the machine).
 */
const MIN_FILL_MS = 800;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Signup anti-bot layer (e2e)', () => {
  let app: INestApplication;
  let http: Parameters<typeof request>[0];
  let sequelize: Sequelize;
  const siteverifyCalls: string[] = [];
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ANTIBOT_CONFIG)
      .useValue({
        ...antibotConfigFromEnv(),
        ticketRequired: true,
        minFillMs: MIN_FILL_MS,
        limitPerEmailDomainHour: 2,
        turnstileSecret: 'e2e-turnstile-secret',
      })
      .overrideProvider(ANTIBOT_FETCH)
      .useValue((input: URL, init?: RequestInit) => {
        const token = new URLSearchParams(init?.body as URLSearchParams).get('response') ?? '';
        siteverifyCalls.push(`${input.hostname}:${token}`);
        return Promise.resolve(new Response(JSON.stringify({ success: token === 'human' }), { status: 200 }));
      })
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix(env.API_PREFIX);
    app.use(requestIdMiddleware);
    app.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    app.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    http = app.getHttpServer();
    sequelize = app.get(Sequelize);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  const ticket = async () => (await request(http).get(url('/auth/register/ticket')).expect(200)).body.data.ticket as string;
  const waitFill = () => new Promise((resolve) => setTimeout(resolve, MIN_FILL_MS + 200));
  const register = (body: Record<string, unknown>, platform?: string) => {
    const call = request(http).post(url('/auth/register')).set('User-Agent', 'Mozilla/5.0 (e2e) Safari/605.1.15');
    if (platform) call.set('X-Client-Platform', platform);
    return call.send({ password: 'e2e-strong-password', nombreCompleto: 'E2E Antibot', ...E2E_SIGNUP_FIELDS, ...body });
  };
  const lastAudit = async () => {
    const [rows] = await sequelize.query(
      `SELECT user_id, ticket_id, reject_reason, risk, risk_reasons, channel, duration_ms FROM auth.signup_audit ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    return rows[0] as Record<string, unknown>;
  };
  const expectGenericRejection = (response: request.Response, reason: string) => {
    expect(response.status).toBe(400);
    expect(response.body.error?.code ?? response.body.code).toBe('SIGNUP_REJECTED');
    expect(JSON.stringify(response.body)).not.toContain(reason);
  };

  it('issues a signed, uncacheable form ticket and a web-safe attestation nonce', async () => {
    const response = await request(http).get(url('/auth/register/ticket')).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.ticket).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(new Date(response.body.data.issuedAt as string).getTime()).toBeLessThanOrEqual(Date.now());

    const challenge = await request(http).get(url('/auth/attestation/challenge')).expect(200);
    expect(challenge.body.data.nonce).toMatch(/^[\w-]{16,500}$/);
  });

  it('rejects a signup without a ticket, generically, and audits why', async () => {
    const response = await register({ email: `no-ticket-${stamp}@a-${stamp}.test` });
    expectGenericRejection(response, 'TICKET_MISSING');
    expect(await lastAudit()).toMatchObject({ user_id: null, reject_reason: 'TICKET_MISSING' });
  });

  it('rejects a form submitted faster than a person can fill it', async () => {
    const response = await register({ ticket: await ticket(), email: `fast-${stamp}@b-${stamp}.test` });
    expectGenericRejection(response, 'TOO_FAST');
    expect(await lastAudit()).toMatchObject({ user_id: null, reject_reason: 'TOO_FAST' });
  });

  let acceptedTicket = '';

  it('accepts a real signup, audits it with the account and spends the ticket in the same commit', async () => {
    acceptedTicket = await ticket();
    await waitFill();
    const response = await register({ ticket: acceptedTicket, email: `human-${stamp}@c-${stamp}.test` });
    expect(response.status).toBe(201);
    const audit = await lastAudit();
    expect(audit).toMatchObject({ reject_reason: null, risk: 'LOW', channel: 'UNKNOWN' });
    expect(audit.user_id).toEqual(expect.any(String));
    expect(Number(audit.duration_ms)).toBeGreaterThanOrEqual(MIN_FILL_MS);
    const [spent] = await sequelize.query(`SELECT kind FROM auth.signup_tickets WHERE id = :id`, {
      replacements: { id: audit.ticket_id },
    });
    expect(spent).toEqual([{ kind: 'FORM' }]);
  });

  it('refuses to reuse a ticket that already created an account', async () => {
    const response = await register({ ticket: acceptedTicket, email: `replay-${stamp}@d-${stamp}.test` });
    expectGenericRejection(response, 'TICKET_REUSED');
    expect(await lastAudit()).toMatchObject({ reject_reason: 'TICKET_REUSED' });
  });

  it('rejects a filled honeypot and a disposable email domain', async () => {
    const [first, second] = [await ticket(), await ticket()];
    await waitFill();
    expectGenericRejection(await register({ ticket: first, website: 'x', email: `pot-${stamp}@e-${stamp}.test` }), 'HONEYPOT');
    expect(await lastAudit()).toMatchObject({ reject_reason: 'HONEYPOT' });
    expectGenericRejection(await register({ ticket: second, email: `bot-${stamp}@inbox.mailinator.com` }), 'DISPOSABLE');
    expect(await lastAudit()).toMatchObject({ reject_reason: 'DISPOSABLE_EMAIL' });
  });

  it('rate-limits signup velocity per email domain', async () => {
    const tickets = [await ticket(), await ticket(), await ticket()];
    await waitFill();
    const domain = `velocity-${stamp}.test`;
    await register({ ticket: tickets[0], email: `v1-${stamp}@${domain}` }).expect(201);
    await register({ ticket: tickets[1], email: `v2-${stamp}@${domain}` }).expect(201);
    expectGenericRejection(await register({ ticket: tickets[2], email: `v3-${stamp}@${domain}` }), 'RATE_LIMITED');
    expect(await lastAudit()).toMatchObject({ reject_reason: 'RATE_LIMITED' });
  });

  it('verifies Turnstile server-side for web signups', async () => {
    const [bot, human] = [await ticket(), await ticket()];
    await waitFill();
    const refused = await register({ ticket: bot, turnstileToken: 'robot', email: `ts-bot-${stamp}@f-${stamp}.test` }, 'WEB');
    expectGenericRejection(refused, 'TURNSTILE');
    expect(await lastAudit()).toMatchObject({ reject_reason: 'TURNSTILE_FAILED', channel: 'WEB' });
    await register({ ticket: human, turnstileToken: 'human', email: `ts-ok-${stamp}@g-${stamp}.test` }, 'WEB').expect(201);
    expect(siteverifyCalls).toEqual(['challenges.cloudflare.com:robot', 'challenges.cloudflare.com:human']);
  });

  describe('GET /admin/signups', () => {
    const signupAs = async (label: string, role: string) => {
      const issued = await ticket();
      await waitFill();
      const response = await register({ ticket: issued, email: `${label}-${stamp}@h${label}-${stamp}.test` }).expect(201);
      const token = response.body.data.accessToken as string;
      const userId = response.body.data.user.id as string;
      await sequelize.query('UPDATE public.usuarios SET rol = :role WHERE id = :userId', { replacements: { role, userId } });
      return { token, userId };
    };

    it('is closed to anonymous callers and to members', async () => {
      await request(http).get(url('/admin/signups')).expect(401);
      const member = await signupAs('member', 'CLIENTE');
      await request(http).get(url('/admin/signups')).set('Authorization', `Bearer ${member.token}`).expect(403);
    });

    it('shows a platform admin every verdict, rejections included, without any IP data', async () => {
      const platform = await signupAs('platform', 'SYSTEM_ADMIN');
      const response = await request(http)
        .get(url('/admin/signups?limit=100'))
        .set('Authorization', `Bearer ${platform.token}`)
        .expect(200);
      const rows = response.body.data as Record<string, unknown>[];
      expect(rows.some((row) => row.rejectReason === 'TURNSTILE_FAILED')).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/ipHmac|ip_hmac/);
      await request(http).get(url('/admin/signups?risk=EXTREME')).set('Authorization', `Bearer ${platform.token}`).expect(400);
    });

    it('shows a platform moderator every verdict (ADR-0018)', async () => {
      const moderator = await signupAs('moderator', 'MODERATOR');
      const rows = (await request(http).get(url('/admin/signups?limit=100'))
        .set('Authorization', `Bearer ${moderator.token}`).expect(200)).body.data as Record<string, unknown>[];
      expect(rows.some((row) => row.accepted === true)).toBe(true);
      expect(rows.some((row) => row.rejectReason === 'TURNSTILE_FAILED')).toBe(true);
    });
  });

  it('exports signup verdict counters on /health/metrics', async () => {
    const call = request(http).get(url('/health/metrics'));
    if (env.METRICS_SCRAPE_TOKEN) call.set('Authorization', `Bearer ${env.METRICS_SCRAPE_TOKEN}`);
    const response = await call.expect(200);
    expect(response.text).toMatch(/gym_sheet_signup_verdicts_total\{outcome="rejected",reason="TICKET_MISSING",risk="LOW"\} \d+/);
    expect(response.text).toMatch(/gym_sheet_signup_verdicts_total\{outcome="accepted",reason="NONE",risk="LOW"\} \d+/);
  });
});
