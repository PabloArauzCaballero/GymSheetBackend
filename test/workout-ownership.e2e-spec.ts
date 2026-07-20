import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/**
 * Horizontal authorization: two real accounts, one real workout session, and
 * the assertion that the owner's data is unreachable through the other
 * account's token no matter how the identifier is supplied.
 */
describe('Workout session ownership isolation (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  const password = 'e2e-strong-password';
  const suffix = Date.now();
  let ownerToken = '';
  let intruderToken = '';
  let ownerSessionId = '';

  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  async function registerAccount(label: string): Promise<string> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `${label}-${suffix}@example.test`,
        password,
        nombreCompleto: `E2E ${label}`,
      })
      .expect(201);
    return response.body.data.accessToken as string;
  }

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

    ownerToken = await registerAccount('owner');
    intruderToken = await registerAccount('intruder');

    const session = await request(httpServer)
      .post(url('/workouts'))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ observacion: 'Owner session for isolation test' })
      .expect(201);
    ownerSessionId = session.body.data.id as string;
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  it('lets the owner read their own session', async () => {
    const response = await request(httpServer)
      .get(url(`/workouts/${ownerSessionId}`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body.data.id).toBe(ownerSessionId);
  });

  it('hides the session from another authenticated account', async () => {
    // 404 rather than 403: a 403 would confirm the identifier exists.
    await request(httpServer)
      .get(url(`/workouts/${ownerSessionId}`))
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(404);
  });

  it.each([
    ['finish', 'patch', `/finish`],
    ['cancel', 'patch', `/cancel`],
  ])('prevents another account from issuing %s on the session', async (_label, method, path) => {
    const agent = request(httpServer);
    await agent[method as 'patch'](url(`/workouts/${ownerSessionId}${path}`))
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(404);
  });

  it('prevents another account from adding an exercise to the session', async () => {
    await request(httpServer)
      .post(url(`/workouts/${ownerSessionId}/exercises`))
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ ejercicioId: '00000000-0000-4000-8000-000000000002', orden: 1 })
      .expect((response) => {
        // Either validation (400) or ownership (404) may answer first; the only
        // unacceptable outcome is the mutation succeeding.
        if (![400, 404].includes(response.status)) {
          throw new Error(`expected 400 or 404, received ${response.status}`);
        }
      });
  });

  it('does not list the owner session under the other account', async () => {
    const response = await request(httpServer)
      .get(url('/workouts'))
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(200);

    const listedIds = (response.body.data.items as { id: string }[]).map((item) => item.id);
    expect(listedIds).not.toContain(ownerSessionId);
  });

  it('rejects a second concurrent session with 409 rather than 500', async () => {
    // Regression guard for the race translated in workouts.service: the owner
    // already holds an in-progress session, so every further attempt (issued in
    // parallel) must be a clean conflict.
    const attempts = await Promise.all(
      [0, 1, 2].map(() =>
        request(httpServer)
          .post(url('/workouts'))
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ observacion: 'Concurrent attempt' }),
      ),
    );

    for (const attempt of attempts) {
      expect(attempt.status).toBe(409);
    }
  });
});
