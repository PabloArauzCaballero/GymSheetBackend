import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { env } from '../../src/config/env';
import { E2E_SIGNUP_FIELDS, markEmailVerified } from '../support/e2e-app';

describe('cross-gym connections (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let sequelize: Sequelize;
  const temporaryTenantIds: string[] = [];
  const connectionIds: string[] = [];
  const testUserIds: string[] = [];
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    sequelize = moduleRef.get(Sequelize);
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
    if (sequelize) {
      if (testUserIds.length > 0) {
        await sequelize.query(
          'DELETE FROM social.discovery_passes WHERE viewer_id IN (:userIds) OR target_id IN (:userIds)',
          { replacements: { userIds: testUserIds } },
        );
        await sequelize.query(
          `UPDATE public.usuarios SET rol = 'CLIENTE' WHERE id IN (:userIds)`,
          { replacements: { userIds: testUserIds } },
        );
        await sequelize.query(
          `UPDATE social.profile_settings
              SET profile_enabled = false, cross_gym_enabled = false, map_enabled = false
            WHERE user_id IN (:userIds)`,
          { replacements: { userIds: testUserIds } },
        );
      }
      if (connectionIds.length > 0) {
        await sequelize.query('DELETE FROM social.connections WHERE id IN (:connectionIds)', {
          replacements: { connectionIds },
        });
      }
      if (temporaryTenantIds.length > 0) {
        await sequelize.query(
          'UPDATE public.usuarios SET tenant_id = :defaultTenantId WHERE id IN (:userIds) AND tenant_id IN (:tenantIds)',
          { replacements: { defaultTenantId: env.DEFAULT_TENANT_ID, userIds: testUserIds, tenantIds: temporaryTenantIds } },
        );
        await sequelize.query('DELETE FROM public.tenants WHERE id IN (:tenantIds)', {
          replacements: { tenantIds: temporaryTenantIds },
        });
      }
    }
    await application?.close();
  });

  it('H3.S1.M1 connects opted-in adult members across gyms and lists the connection for both', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporaryTenantId = `connections-e2e-${suffix}`;
    temporaryTenantIds.push(temporaryTenantId);
    await sequelize.query(
      `INSERT INTO public.tenants (id, nombre, estado)
       VALUES (:tenantId, 'Connections e2e', 'ACTIVO')`,
      { replacements: { tenantId: temporaryTenantId } },
    );

    const register = async (label: string) => {
      const email = `connections-${label}-${suffix}@example.test`;
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({
          email,
          password: 'connections-e2e-password',
          nombreCompleto: `Connections ${label} ${suffix}`,
          ...E2E_SIGNUP_FIELDS,
        })
        .expect(201);
      await markEmailVerified(application, response.body.data.user.id as string);
      return {
        accessToken: response.body.data.accessToken as string,
        userId: response.body.data.user.id as string,
      };
    };

    const requester = await register('requester');
    const addressee = await register('addressee');
    testUserIds.push(requester.userId, addressee.userId);
    await sequelize.query(
      'UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :userId',
      { replacements: { tenantId: temporaryTenantId, userId: addressee.userId } },
    );

    const setAdultProfile = async (token: string) => {
      await request(httpServer)
        .post(url('/profile'))
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaNacimiento: '1990-01-01', pesoKg: 70, estaturaCm: 170, objetivo: 'HIPERTROFIA' })
        .expect(201);
    };
    const enableCrossGym = async (token: string) => {
      await request(httpServer)
        .patch(url('/me/social-discovery-settings'))
        .set('Authorization', `Bearer ${token}`)
        .send({ profileEnabled: true, crossGymEnabled: true, mapEnabled: false, expectedVersion: 0 })
        .expect(200);
    };
    await Promise.all([
      setAdultProfile(requester.accessToken),
      setAdultProfile(addressee.accessToken),
      enableCrossGym(requester.accessToken),
      enableCrossGym(addressee.accessToken),
    ]);

    const sent = await request(httpServer)
      .post(url('/me/connections'))
      .set('Authorization', `Bearer ${requester.accessToken}`)
      .send({ addresseeId: addressee.userId })
      .expect(201);
    const connectionId = sent.body.data.id as string;
    connectionIds.push(connectionId);
    expect(sent.body.data.status).toBe('PENDING');

    await request(httpServer)
      .patch(url(`/me/connections/${connectionId}`))
      .set('Authorization', `Bearer ${addressee.accessToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);

    for (const member of [requester, addressee]) {
      const listed = await request(httpServer)
        .get(url('/me/connections?status=ACCEPTED'))
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(200);
      expect(listed.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: connectionId, status: 'ACCEPTED' }),
      ]));
    }
  }, 60000);

  it('H3.S1.M3 serializes simultaneous cross-gym requests into one accepted connection', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporaryTenantId = `connections-race-${suffix}`;
    temporaryTenantIds.push(temporaryTenantId);
    await sequelize.query(
      `INSERT INTO public.tenants (id, nombre, estado)
       VALUES (:tenantId, 'Connections race e2e', 'ACTIVO')`,
      { replacements: { tenantId: temporaryTenantId } },
    );
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({
          email: `connections-race-${label}-${suffix}@example.test`,
          password: 'connections-race-password',
          nombreCompleto: `Connections race ${label} ${suffix}`,
          ...E2E_SIGNUP_FIELDS,
        })
        .expect(201);
      await markEmailVerified(application, response.body.data.user.id as string);
      const member = {
        accessToken: response.body.data.accessToken as string,
        userId: response.body.data.user.id as string,
      };
      testUserIds.push(member.userId);
      return member;
    };
    const [a, b] = await Promise.all([register('a'), register('b')]);
    await sequelize.query('UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :userId', {
      replacements: { tenantId: temporaryTenantId, userId: b.userId },
    });
    const configure = async (member: { accessToken: string }) => {
      await request(httpServer)
        .post(url('/profile'))
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ fechaNacimiento: '1990-01-01', pesoKg: 70, estaturaCm: 170, objetivo: 'HIPERTROFIA' })
        .expect(201);
      await request(httpServer)
        .patch(url('/me/social-discovery-settings'))
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ profileEnabled: true, crossGymEnabled: true, mapEnabled: false, expectedVersion: 0 })
        .expect(200);
    };
    await Promise.all([configure(a), configure(b)]);

    const send = (requester: typeof a, addressee: typeof b) =>
      request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${requester.accessToken}`)
        .send({ addresseeId: addressee.userId })
        .expect(201);
    const [aResponse, bResponse] = await Promise.all([send(a, b), send(b, a)]);
    const connectionIdsReturned = [aResponse.body.data.id, bResponse.body.data.id] as string[];
    connectionIds.push(...new Set(connectionIdsReturned));
    expect(new Set(connectionIdsReturned).size).toBe(1);
    expect([aResponse.body.data.status, bResponse.body.data.status]).toContain('ACCEPTED');

    const [rows] = await sequelize.query<{ count: string; status: string }>(
      `SELECT COUNT(*)::text AS count, MIN(status) AS status FROM social.connections
        WHERE (requester_id = :aId AND addressee_id = :bId)
           OR (requester_id = :bId AND addressee_id = :aId)
       GROUP BY LEAST(requester_id::text, addressee_id::text), GREATEST(requester_id::text, addressee_id::text)`,
      { type: QueryTypes.SELECT, replacements: { aId: a.userId, bId: b.userId } },
    );
    expect(rows).toMatchObject({ count: '1', status: 'ACCEPTED' });
  }, 60000);

  it('H3.S1.M4 prevents a third person from accepting someone else’s request', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({
          email: `connections-owner-${label}-${suffix}@example.test`,
          password: 'connections-owner-password',
          nombreCompleto: `Connections owner ${label} ${suffix}`,
          ...E2E_SIGNUP_FIELDS,
        })
        .expect(201);
      await markEmailVerified(application, response.body.data.user.id as string);
      const member = {
        accessToken: response.body.data.accessToken as string,
        userId: response.body.data.user.id as string,
      };
      testUserIds.push(member.userId);
      return member;
    };
    const [a, b, c] = await Promise.all([register('a'), register('b'), register('c')]);
    const sent = await request(httpServer)
      .post(url('/me/connections'))
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.userId })
      .expect(201);
    const connectionId = sent.body.data.id as string;
    connectionIds.push(connectionId);

    await request(httpServer)
      .patch(url(`/me/connections/${connectionId}`))
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ action: 'ACCEPT' })
      .expect(404);
    const [connection] = await sequelize.query<{ status: string }>(
      'SELECT status FROM social.connections WHERE id = :connectionId',
      { type: QueryTypes.SELECT, replacements: { connectionId } },
    );
    expect(connection.status).toBe('PENDING');
  }, 60000);

  it('H3.S1.M5 keeps a cross-gym pass after a fresh session until the owner removes it', async () => {
    let phase = 'create isolated tenant';
    try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporaryTenantId = `connections-pass-${suffix}`;
    temporaryTenantIds.push(temporaryTenantId);
    await sequelize.query(
      `INSERT INTO public.tenants (id, nombre, estado)
       VALUES (:tenantId, 'Connections pass e2e', 'ACTIVO')`,
      { replacements: { tenantId: temporaryTenantId } },
    );
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({
          email: `connections-pass-${label}-${suffix}@example.test`,
          password: 'connections-pass-password',
          nombreCompleto: `Connections pass ${label} ${suffix}`,
          ...E2E_SIGNUP_FIELDS,
        })
        .expect(201);
      await markEmailVerified(application, response.body.data.user.id as string);
      const member = {
        accessToken: response.body.data.accessToken as string,
        userId: response.body.data.user.id as string,
        email: `connections-pass-${label}-${suffix}@example.test`,
        password: 'connections-pass-password',
      };
      testUserIds.push(member.userId);
      return member;
    };
    const [a, b] = await Promise.all([register('a'), register('b')]);
    phase = 'move target to the second tenant';
    await sequelize.query('UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :userId', {
      replacements: { tenantId: temporaryTenantId, userId: b.userId },
    });
    const configure = async (member: { accessToken: string }) => {
      await request(httpServer)
        .post(url('/profile'))
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ fechaNacimiento: '1990-01-01', pesoKg: 70, estaturaCm: 170, objetivo: 'HIPERTROFIA' })
        .expect(201);
      await request(httpServer)
        .patch(url('/me/social-discovery-settings'))
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ profileEnabled: true, crossGymEnabled: true, mapEnabled: false, expectedVersion: 0 })
        .expect(200);
    };
    phase = 'enable adult profiles and bilateral discovery consent';
    await configure(a);
    await configure(b);

    phase = 'persist the pass';
    await request(httpServer)
      .post(url('/me/discovery/swipes'))
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ targetId: b.userId, direction: 'PASS' })
      .expect(201);
    phase = 'authenticate a fresh session';
    const reauthenticated = await request(httpServer)
      .post(url('/auth/login'))
      .send({ email: a.email, password: a.password })
      .expect(201);
    const freshToken = reauthenticated.body.data.accessToken as string;
    phase = 'read pass history from the fresh session';
    const passesAfterNewSession = await request(httpServer)
      .get(url('/me/interactions/passes-sent'))
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);
    expect(passesAfterNewSession.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: b.userId })]),
    );

    phase = 'explicitly remove the pass';
    await request(httpServer)
      .delete(url(`/me/interactions/passes/${b.userId}`))
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);
    const passesAfterExplicitRemoval = await request(httpServer)
      .get(url('/me/interactions/passes-sent'))
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);
    expect(passesAfterExplicitRemoval.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: b.userId })]),
    );
    } catch (error) {
      throw new Error(`H3.S1.M5 failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }, 60000);
});
