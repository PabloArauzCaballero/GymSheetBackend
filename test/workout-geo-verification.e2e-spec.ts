import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';
import { BranchModel } from '../src/modules/facilities/branch.model';

/**
 * Verificación de racha por geolocalización (punto 7 del audit): al finalizar
 * una sesión con coordenadas, el backend la marca como verificada si cae
 * dentro del radio de alguna sede real — contra Postgres, no solo la función
 * pura de `geo-verification.util.spec.ts`.
 */
describe('Workout geo-verification (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let branchModel: typeof BranchModel;

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
    branchModel = moduleRef.get(getModelToken(BranchModel));
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  async function registerAccount(label: string): Promise<string> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `geo-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Geo ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  async function createBranch(
    label: string,
    coordinates: { latitude: number; longitude: number; geofenceRadiusM: number } | null,
  ): Promise<BranchModel> {
    return branchModel.create({
      code: `e2e-geo-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: `Sede E2E ${label}`,
      timeZone: env.BUSINESS_TIME_ZONE,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      geofenceRadiusM: coordinates?.geofenceRadiusM ?? null,
    });
  }

  async function startAndFinishSession(
    accessToken: string,
    location?: { latitude: number; longitude: number },
  ) {
    const started = await request(httpServer)
      .post(url('/workouts'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);
    const sessionId = started.body.data.id as string;

    return request(httpServer)
      .patch(url(`/workouts/${sessionId}/finish`))
      .set('Authorization', `Bearer ${accessToken}`)
      .send(location ?? {})
      .expect(200);
  }

  it('does not verify a session finished without location', async () => {
    const accessToken = await registerAccount('no-location');
    await createBranch('no-location', { latitude: 0, longitude: 0, geofenceRadiusM: 200 });

    const response = await startAndFinishSession(accessToken);

    expect(response.body.data.geoVerificada).toBe(false);
  });

  it('verifies a session whose reported location falls inside a branch geofence', async () => {
    const accessToken = await registerAccount('inside');
    await createBranch('inside', { latitude: 10, longitude: 10, geofenceRadiusM: 300 });

    const response = await startAndFinishSession(accessToken, { latitude: 10.0005, longitude: 10 });

    expect(response.body.data.geoVerificada).toBe(true);
  });

  it('does not verify a session whose reported location falls outside every branch geofence', async () => {
    const accessToken = await registerAccount('outside');
    await createBranch('outside', { latitude: 20, longitude: 20, geofenceRadiusM: 50 });

    const response = await startAndFinishSession(accessToken, { latitude: 21, longitude: 20 });

    expect(response.body.data.geoVerificada).toBe(false);
  });

  it('ignores branches without configured coordinates', async () => {
    const accessToken = await registerAccount('no-coordinates');
    await createBranch('no-coordinates', null);

    const response = await startAndFinishSession(accessToken, { latitude: 30, longitude: 30 });

    expect(response.body.data.geoVerificada).toBe(false);
  });

  it('rejects an out-of-range latitude with a validation error', async () => {
    const accessToken = await registerAccount('invalid-lat');
    const started = await request(httpServer)
      .post(url('/workouts'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);
    const sessionId = started.body.data.id as string;

    await request(httpServer)
      .patch(url(`/workouts/${sessionId}/finish`))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 200, longitude: 0 })
      .expect(400);
  });
});
