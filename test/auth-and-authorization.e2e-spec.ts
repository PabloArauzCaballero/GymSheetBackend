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
 * Exercises the guard chain end to end against a real PostgreSQL instance.
 * These paths (JwtAuthGuard, RolesGuard, HttpExceptionFilter, request-id
 * middleware) cannot be covered meaningfully by unit tests alone because their
 * contract is the composed HTTP behaviour, not the individual class.
 */
describe('Authentication and authorization (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  const uniqueEmail = `e2e-${Date.now()}@example.test`;
  const password = 'e2e-strong-password';
  let accessToken = '';

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
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  describe('public routes', () => {
    it('registers a new client account', async () => {
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({ email: uniqueEmail, password, nombreCompleto: 'E2E Test User' })
        .expect(201);

      expect(response.body.data.accessToken).toEqual(expect.any(String));
      accessToken = response.body.data.accessToken as string;
    });

    it('assigns the client role and never honours a caller-supplied role', async () => {
      // Mass-assignment guard: the registration schema must drop `rol`.
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({
          email: `escalation-${Date.now()}@example.test`,
          password,
          nombreCompleto: 'Escalation Attempt',
          rol: 'ADMIN',
        })
        .expect(201);

      expect(response.body.data.user.rol).toBe('CLIENTE');
    });

    it('reports liveness without authentication', async () => {
      await request(httpServer).get(url('/health/live')).expect(200);
    });
  });

  describe('unauthenticated access to protected routes', () => {
    it.each([
      ['GET', '/auth/me'],
      ['GET', '/workouts'],
    ])('rejects %s %s with 401', async (method, path) => {
      const agent = request(httpServer);
      await agent[method.toLowerCase() as 'get'](url(path)).expect(401);
    });

    it.each([
      ['malformed token', 'Bearer not-a-real-token'],
      ['empty bearer', 'Bearer '],
      ['wrong scheme', 'Basic dXNlcjpwYXNz'],
      ['algorithm-none style payload', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.'],
    ])('rejects a request carrying a %s', async (_label, authorization) => {
      await request(httpServer)
        .get(url('/auth/me'))
        .set('Authorization', authorization)
        .expect(401);
    });
  });

  describe('authenticated access', () => {
    it('returns the authenticated principal', async () => {
      const response = await request(httpServer)
        .get(url('/auth/me'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.email).toBe(uniqueEmail);
      expect(response.body.data.role).toBe('CLIENTE');
    });

    it('never returns the password hash to the client', async () => {
      const response = await request(httpServer)
        .get(url('/auth/me'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/\$2[aby]\$/);
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });
  });

  describe('login contract', () => {
    it('accepts the registered credentials', async () => {
      await request(httpServer)
        .post(url('/auth/login'))
        .send({ email: uniqueEmail, password })
        .expect(201);
    });

    it('returns an identical rejection for a wrong password and an unknown email', async () => {
      const wrongPassword = await request(httpServer)
        .post(url('/auth/login'))
        .send({ email: uniqueEmail, password: 'definitely-not-the-password' })
        .expect(401);
      const unknownEmail = await request(httpServer)
        .post(url('/auth/login'))
        .send({ email: `absent-${Date.now()}@example.test`, password })
        .expect(401);

      expect(unknownEmail.body.detail).toBe(wrongPassword.body.detail);
    });
  });

  describe('input validation and error contract', () => {
    it('rejects a malformed payload with 400 and field-level issues', async () => {
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({ email: 'not-an-email', password: 'short', nombreCompleto: 'x' })
        .expect(400);

      expect(response.body.detail).toBe('Datos de entrada inválidos.');
      expect(response.body.issues.fieldErrors).toHaveProperty('email');
    });

    it('rejects a non-UUID path parameter without reaching the database', async () => {
      await request(httpServer)
        .get(url('/workouts/not-a-uuid'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('does not leak internal details on a not-found resource', async () => {
      const response = await request(httpServer)
        .get(url('/workouts/00000000-0000-4000-8000-0000000000ff'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toMatch(/sequelize|SELECT|postgres|at Object/i);
    });
  });

  describe('correlation identifier', () => {
    it('echoes a well-formed caller-supplied request id', async () => {
      const response = await request(httpServer)
        .get(url('/health/live'))
        .set('X-Request-Id', 'e2e-correlation-0001')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('e2e-correlation-0001');
    });

    it('replaces a header-injection attempt with a generated identifier', async () => {
      const response = await request(httpServer)
        .get(url('/health/live'))
        .set('X-Request-Id', 'abcdefgh<script>alert(1)</script>')
        .expect(200);

      expect(response.headers['x-request-id']).not.toContain('<script>');
    });

    it('always returns a correlation id even when none is supplied', async () => {
      const response = await request(httpServer).get(url('/health/live')).expect(200);

      expect(response.headers['x-request-id']).toEqual(expect.any(String));
    });
  });
});
