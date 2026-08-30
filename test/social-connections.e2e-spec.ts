import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/** Punto 11 y 10 del audit: solicitudes de conexión y estado social del perfil. */
describe('Social connections and status (e2e)', () => {
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

  async function registerAccount(label: string): Promise<{ accessToken: string; userId: string }> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `social-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Social ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return {
      accessToken: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  }

  describe('connection requests', () => {
    it('sends a pending request and lists it for both sides', async () => {
      const a = await registerAccount('req-a');
      const b = await registerAccount('req-b');

      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);
      expect(sent.body.data.status).toBe('PENDING');
      expect(sent.body.data.direction).toBe('SENT');

      const fromSender = await request(httpServer)
        .get(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(fromSender.body.data).toHaveLength(1);
      expect(fromSender.body.data[0].direction).toBe('SENT');

      const fromReceiver = await request(httpServer)
        .get(url('/me/connections'))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(fromReceiver.body.data).toHaveLength(1);
      expect(fromReceiver.body.data[0].direction).toBe('RECEIVED');
    });

    it('rejects sending a request to yourself', async () => {
      const a = await registerAccount('self');
      await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: a.userId })
        .expect(400);
    });

    it('lets the addressee accept a request, and rejects a second identical request', async () => {
      const a = await registerAccount('acc-a');
      const b = await registerAccount('acc-b');
      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);

      await request(httpServer)
        .patch(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ action: 'ACCEPT' })
        .expect(200);

      await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(409);
    });

    it('does not let the requester accept their own request', async () => {
      const a = await registerAccount('own-a');
      const b = await registerAccount('own-b');
      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);

      await request(httpServer)
        .patch(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ action: 'ACCEPT' })
        .expect(404);
    });

    it('auto-accepts a mutual request instead of leaving two pending rows', async () => {
      const a = await registerAccount('mutual-a');
      const b = await registerAccount('mutual-b');

      await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);

      const mutual = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ addresseeId: a.userId })
        .expect(201);
      expect(mutual.body.data.status).toBe('ACCEPTED');

      const list = await request(httpServer)
        .get(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].status).toBe('ACCEPTED');
    });

    it('lets a rejected request be sent again later', async () => {
      const a = await registerAccount('retry-a');
      const b = await registerAccount('retry-b');
      const first = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);

      await request(httpServer)
        .patch(url(`/me/connections/${first.body.data.id}`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ action: 'REJECT' })
        .expect(200);

      await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);
    });

    it('lets the requester withdraw a pending request, but not the addressee', async () => {
      const a = await registerAccount('withdraw-a');
      const b = await registerAccount('withdraw-b');
      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);

      await request(httpServer)
        .delete(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(404);

      await request(httpServer)
        .delete(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
    });
  });

  /**
   * Ningún otro archivo e2e de este repo completa el paso de preferencias del
   * onboarding, así que `trainingLocation` (un enum cerrado: solo puede
   * quedar en NULL o en el valor que elijamos aquí) es la única señal que
   * ningún otro test deja escrita: filtrar el directorio por ella aísla estas
   * cuentas del resto de la base de datos desechable, que la suite entera
   * comparte y va acumulando cuentas.
   */
  async function markLocation(
    accessToken: string,
    trainingLocation: 'GYM' | 'HOME' | 'OUTDOORS' | 'MIXED',
  ): Promise<void> {
    await request(httpServer)
      .put(url('/me/onboarding/preferences'))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        experienceLevel: 'BEGINNER',
        weeklyFrequency: 3,
        trainingLocation,
        trainingPreferences: [],
        consentHealth: true,
        consentData: true,
      })
      .expect(200);
  }

  describe('social status visibility', () => {
    it('shows the social status only to an accepted, visible connection — never to a stranger', async () => {
      const owner = await registerAccount('status-owner');
      const stranger = await registerAccount('status-stranger');
      const friend = await registerAccount('status-friend');
      const marker = 'OUTDOORS';
      await Promise.all(
        [owner, stranger, friend].map((account) => markLocation(account.accessToken, marker)),
      );

      await request(httpServer)
        .patch(url('/me/social-status'))
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ socialStatus: 'SINGLE', visible: true })
        .expect(200);

      // Connect owner and friend, but not owner and stranger.
      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ addresseeId: friend.userId })
        .expect(201);
      await request(httpServer)
        .patch(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${friend.accessToken}`)
        .send({ action: 'ACCEPT' })
        .expect(200);

      const seenByStranger = await request(httpServer)
        .get(url(`/me/gym-directory?ubicacion=${marker}&limit=50`))
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(200);
      const ownerForStranger = (
        seenByStranger.body.data as Array<{ userId: string; connectionStatus: string; socialStatus: string | null }>
      ).find((entry) => entry.userId === owner.userId);
      expect(ownerForStranger?.connectionStatus).toBe('NONE');
      expect(ownerForStranger?.socialStatus).toBeNull();

      const seenByFriend = await request(httpServer)
        .get(url(`/me/gym-directory?ubicacion=${marker}&limit=50`))
        .set('Authorization', `Bearer ${friend.accessToken}`)
        .expect(200);
      const ownerForFriend = (
        seenByFriend.body.data as Array<{ userId: string; connectionStatus: string; socialStatus: string | null }>
      ).find((entry) => entry.userId === owner.userId);
      expect(ownerForFriend?.connectionStatus).toBe('ACCEPTED');
      expect(ownerForFriend?.socialStatus).toBe('SINGLE');
    });

    it('hides the social status from a connection when marked not visible', async () => {
      const owner = await registerAccount('status-hidden-owner');
      const friend = await registerAccount('status-hidden-friend');
      const marker = 'MIXED';
      await Promise.all([owner, friend].map((account) => markLocation(account.accessToken, marker)));

      await request(httpServer)
        .patch(url('/me/social-status'))
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ socialStatus: 'OPEN_TO_MEET', visible: false })
        .expect(200);

      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ addresseeId: friend.userId })
        .expect(201);
      await request(httpServer)
        .patch(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${friend.accessToken}`)
        .send({ action: 'ACCEPT' })
        .expect(200);

      const directory = await request(httpServer)
        .get(url(`/me/gym-directory?ubicacion=${marker}&limit=50`))
        .set('Authorization', `Bearer ${friend.accessToken}`)
        .expect(200);
      const entry = (
        directory.body.data as Array<{ userId: string; connectionStatus: string; socialStatus: string | null }>
      ).find((row) => row.userId === owner.userId);
      expect(entry?.connectionStatus).toBe('ACCEPTED');
      expect(entry?.socialStatus).toBeNull();
    });
  });

  describe('gym directory', () => {
    it('never lists the viewer themselves', async () => {
      const a = await registerAccount('dir-self');
      const response = await request(httpServer)
        .get(url('/me/gym-directory'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(
        (response.body.data as Array<{ userId: string }>).some((entry) => entry.userId === a.userId),
      ).toBe(false);
    });

    it('reflects an accepted connection in the directory entry', async () => {
      const a = await registerAccount('dir-a');
      const b = await registerAccount('dir-b');
      await Promise.all([a, b].map((account) => markLocation(account.accessToken, 'HOME')));
      const sent = await request(httpServer)
        .post(url('/me/connections'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ addresseeId: b.userId })
        .expect(201);
      await request(httpServer)
        .patch(url(`/me/connections/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ action: 'ACCEPT' })
        .expect(200);

      const directory = await request(httpServer)
        .get(url('/me/gym-directory?ubicacion=HOME&limit=50'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      const entry = (directory.body.data as Array<{ userId: string; connectionStatus: string }>).find(
        (row) => row.userId === b.userId,
      );
      expect(entry?.connectionStatus).toBe('ACCEPTED');
    });
  });
});
