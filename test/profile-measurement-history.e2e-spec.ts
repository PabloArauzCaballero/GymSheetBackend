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
 * Punto 1 del audit: editar el perfil (`PATCH /profile`) debe alimentar el
 * mismo histórico que ya usa `GET /me/body-measurements`, en vez de ser una
 * fuente de verdad aparte que el móvil no podía mostrar como evolución.
 */
describe('Profile edits feed the body-measurement history (e2e)', () => {
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
        email: `profile-history-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Historial ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  it('records a history entry the first time the profile is created', async () => {
    const accessToken = await registerAccount('create');

    await request(httpServer)
      .post(url('/profile'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ edad: 28, pesoKg: 80, estaturaCm: 178, objetivo: 'HIPERTROFIA' })
      .expect(201);

    const history = await request(httpServer)
      .get(url('/me/body-measurements'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ weight: 80, unit: 'KG', source: 'PROFILE' });
  });

  it('appends a new entry when the weight actually changes, and keeps the earlier one', async () => {
    const accessToken = await registerAccount('change');
    await request(httpServer)
      .post(url('/profile'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ edad: 28, pesoKg: 80, estaturaCm: 178, objetivo: 'HIPERTROFIA' })
      .expect(201);

    await request(httpServer)
      .patch(url('/profile'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ edad: 28, pesoKg: 81.5, estaturaCm: 178, objetivo: 'HIPERTROFIA' })
      .expect(200);

    const history = await request(httpServer)
      .get(url('/me/body-measurements'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(history.body.data).toHaveLength(2);
    const weights = (history.body.data as Array<{ weight: number }>).map((item) => item.weight);
    expect(weights.sort()).toEqual([80, 81.5]);
  });

  it('does not duplicate the entry when the same weight is saved again the same day', async () => {
    const accessToken = await registerAccount('same');
    await request(httpServer)
      .post(url('/profile'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ edad: 28, pesoKg: 80, estaturaCm: 178, objetivo: 'HIPERTROFIA' })
      .expect(201);

    // Solo cambia la edad; el peso se reenvía igual.
    await request(httpServer)
      .patch(url('/profile'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ edad: 29, pesoKg: 80, estaturaCm: 178, objetivo: 'HIPERTROFIA' })
      .expect(200);

    const history = await request(httpServer)
      .get(url('/me/body-measurements'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(history.body.data).toHaveLength(1);
  });
});
