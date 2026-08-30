import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/** Punto 3 del audit: el incremento de peso de los chips deja de estar fijo en 2.5kg. */
describe('User preferences: weight increment (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  const password = 'e2e-strong-password';

  function url(path: string): string {
    return `/${env.API_PREFIX}${path}`;
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
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  async function registerAccount(label: string): Promise<string> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `weight-pref-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Peso ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  it('defaults new accounts to a 2.5kg increment', async () => {
    const accessToken = await registerAccount('default');

    const response = await request(httpServer)
      .get(url('/users/me'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.pesoIncrementoKg).toBe(2.5);
  });

  it('persists a custom increment', async () => {
    const accessToken = await registerAccount('custom');

    await request(httpServer)
      .patch(url('/users/me'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pesoIncrementoKg: 1.25 })
      .expect(200);

    const response = await request(httpServer)
      .get(url('/users/me'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.pesoIncrementoKg).toBe(1.25);
  });

  it('rejects a non-positive increment', async () => {
    const accessToken = await registerAccount('invalid');

    await request(httpServer)
      .patch(url('/users/me'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pesoIncrementoKg: 0 })
      .expect(400);
  });
});
