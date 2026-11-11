import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/**
 * Rotating refresh tokens end to end against PostgreSQL (SEC-02): login and
 * register hand out a refresh token, `/auth/refresh` rotates it, reuse of a
 * rotated token kills the session, and `/auth/logout` revokes it.
 */
describe('Refresh tokens (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let sequelize: Sequelize;

  const email = `refresh-${Date.now()}@example.test`;
  const password = 'e2e-strong-password';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();
    sequelize = moduleRef.get(Sequelize);

    await request(httpServer)
      .post(url('/auth/register'))
      .send({ email, password, nombreCompleto: 'Refresh E2E' })
      .expect(201);
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  /**
   * `/auth/login` and `/auth/register` keep their strict brute-force limit
   * (AUTH_RATE_LIMIT_MAX, 10 per minute and IP by default): the whole file
   * stays under it. `/auth/refresh` and `/auth/logout` use the general limit.
   */
  async function login(): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await request(httpServer)
      .post(url('/auth/login'))
      .send({ email, password })
      .expect(201);
    return response.body.data as { accessToken: string; refreshToken: string };
  }

  const refresh = (refreshToken: unknown) =>
    request(httpServer).post(url('/auth/refresh')).send({ refreshToken });

  it('login returns a refresh token, and only its hash is stored', async () => {
    const session = await login();
    expect(session.refreshToken).toEqual(expect.any(String));
    expect(session.refreshToken.length).toBeGreaterThanOrEqual(40);

    const rows = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM auth.refresh_tokens WHERE token_hash = :token`,
      { replacements: { token: session.refreshToken }, type: QueryTypes.SELECT },
    );
    expect(rows[0].count).toBe('0');
  });

  it('rotates: a new pair that works, and the old refresh token is spent', async () => {
    const session = await login();

    const rotated = await refresh(session.refreshToken).expect(200);
    const next = rotated.body.data as { accessToken: string; refreshToken: string };
    expect(next.refreshToken).not.toBe(session.refreshToken);

    const me = await request(httpServer)
      .get(url('/auth/me'))
      .set('Authorization', `Bearer ${next.accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(email);

    // keeps rotating while used
    await refresh(next.refreshToken).expect(200);
  });

  it('reusing a spent refresh token revokes the whole session', async () => {
    const session = await login();
    const rotated = await refresh(session.refreshToken).expect(200);
    const successor = (rotated.body.data as { refreshToken: string }).refreshToken;

    await refresh(session.refreshToken).expect(401);
    // the legitimate holder's successor dies too: a leaked token stops working
    await refresh(successor).expect(401);
  });

  it('logout revokes the session and is idempotent', async () => {
    const session = await login();

    const first = await request(httpServer)
      .post(url('/auth/logout'))
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(first.body.data).toEqual({ revoked: true });

    const second = await request(httpServer)
      .post(url('/auth/logout'))
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(second.body.data).toEqual({ revoked: false });

    await refresh(session.refreshToken).expect(401);
  });

  it('logging out one device leaves the other signed in', async () => {
    const phone = await login();
    const tablet = await login();

    await request(httpServer)
      .post(url('/auth/logout'))
      .send({ refreshToken: phone.refreshToken })
      .expect(200);

    await refresh(tablet.refreshToken).expect(200);
  });

  it('a deactivated account cannot renew its session', async () => {
    const blockedEmail = `inactive-${Date.now()}@example.test`;
    const registered = await request(httpServer)
      .post(url('/auth/register'))
      .send({ email: blockedEmail, password, nombreCompleto: 'Inactive E2E' })
      .expect(201);
    const { refreshToken, user } = registered.body.data as {
      refreshToken: string;
      user: { id: string };
    };

    await sequelize.query(`UPDATE public.usuarios SET estado = 'INACTIVO' WHERE id = :id`, {
      replacements: { id: user.id },
    });

    await refresh(refreshToken).expect(401);
  });

  it('rejects an unknown refresh token with 401', async () => {
    await refresh('x'.repeat(43)).expect(401);
  });

  it('does not accept an access token as a refresh token', async () => {
    const { accessToken } = await login();
    const response = await refresh(accessToken);
    expect([400, 401]).toContain(response.status);
  });

  it.each([
    ['missing body field', undefined],
    ['wrong type', 12345],
    ['too short', 'abc'],
  ])('rejects a malformed body (%s) with 400', async (_label, value) => {
    await refresh(value).expect(400);
  });
});
