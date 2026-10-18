import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { Sequelize } from 'sequelize-typescript';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';
import { ChatDisappearingPurgeService } from '../src/modules/chat/chat-disappearing-purge.service';

type Account = { accessToken: string; userId: string };

// Cada caso registra y conecta dos cuentas reales: el plazo por defecto (5 s) no alcanza.
jest.setTimeout(30000);

/**
 * Chat 2026-10-18: editar (15 min, solo texto, evento a ambos), ubicación con
 * nombre del lugar y mensajes temporales por conversación. Se ejercita contra
 * PostgreSQL real y con el socket escuchando, como lo usa el móvil.
 */
describe('Chat: edit, place labels and disappearing messages (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let baseUrl: string;
  let sequelize: Sequelize;
  const sockets: Socket[] = [];

  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.listen(0);
    const address = application.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' ? address?.port : 0}`;
    httpServer = application.getHttpServer();
    sequelize = application.get(Sequelize);
  }, 60000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await application?.close();
  });

  async function register(label: string): Promise<Account> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `chat2-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password: 'e2e-strong-password',
        nombreCompleto: `Chat2 ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return { accessToken: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function pair(): Promise<{ a: Account; b: Account; conversationId: string }> {
    const a = await register('a');
    const b = await register('b');
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
    const started = await request(httpServer)
      .post(url('/me/conversations'))
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ otherUserId: b.userId })
      .expect(201);
    return { a, b, conversationId: started.body.data.conversationId };
  }

  async function joinedSocket(account: Account, conversationId: string): Promise<Socket> {
    const ticket = await request(httpServer)
      .post(url('/auth/socket-ticket'))
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);
    const socket = io(`${baseUrl}/chat`, { auth: { ticket: ticket.body.data.ticket }, transports: ['websocket'] });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    await new Promise((resolve) => socket.emit('conversation:join', { conversationId }, resolve));
    return socket;
  }

  function nextEvent<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event}`)), 5000);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  const send = (account: Account, conversationId: string, body: Record<string, unknown>) =>
    request(httpServer)
      .post(url(`/me/conversations/${conversationId}/messages`))
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send(body);

  const history = (account: Account, conversationId: string) =>
    request(httpServer)
      .get(url(`/me/conversations/${conversationId}/messages`))
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

  describe('editing', () => {
    it('edits a text within 15 minutes and both participants get message:updated', async () => {
      const { a, b, conversationId } = await pair();
      const socketB = await joinedSocket(b, conversationId);
      const sent = await send(a, conversationId, { type: 'text', body: 'Nos vemos a las 7' }).expect(201);

      const updated = nextEvent<{ id: string; body: string; editedAt: string }>(socketB, 'message:updated');
      const edited = await request(httpServer)
        .patch(url(`/me/conversations/${conversationId}/messages/${sent.body.data.id}`))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ body: 'Nos vemos a las 8' })
        .expect(200);

      expect(edited.body.data.body).toBe('Nos vemos a las 8');
      expect(edited.body.data.editedAt).toEqual(expect.any(String));
      await expect(updated).resolves.toMatchObject({ id: sent.body.data.id, body: 'Nos vemos a las 8' });
      const seenByB = await history(b, conversationId);
      expect(seenByB.body.data[0]).toMatchObject({ body: 'Nos vemos a las 8', editedAt: expect.any(String) });
    });

    it('refuses to edit after 15 minutes, someone else’s message or a non-text message', async () => {
      const { a, b, conversationId } = await pair();
      const text = await send(a, conversationId, { type: 'text', body: 'Hola' }).expect(201);
      const place = await send(a, conversationId, { type: 'location', locationLat: -16.5, locationLng: -68.1 }).expect(201);

      await request(httpServer)
        .patch(url(`/me/conversations/${conversationId}/messages/${text.body.data.id}`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ body: 'Ajeno' })
        .expect(404);
      await request(httpServer)
        .patch(url(`/me/conversations/${conversationId}/messages/${place.body.data.id}`))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ body: 'No' })
        .expect(400);

      await sequelize.query(`UPDATE chat.messages SET created_at = now() - interval '16 minutes' WHERE id = :id`, {
        replacements: { id: text.body.data.id },
      });
      await request(httpServer)
        .patch(url(`/me/conversations/${conversationId}/messages/${text.body.data.id}`))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ body: 'Tarde' })
        .expect(400);
    });
  });

  describe('location with a place label', () => {
    it('stores and returns the label of a place picked on the map', async () => {
      const { a, b, conversationId } = await pair();
      const sent = await send(a, conversationId, {
        type: 'location',
        locationLat: -16.5103,
        locationLng: -68.1302,
        locationLabel: 'Gimnasio Sopocachi · Av. 20 de Octubre',
      }).expect(201);
      expect(sent.body.data).toMatchObject({ type: 'location', locationLabel: 'Gimnasio Sopocachi · Av. 20 de Octubre' });

      const current = await send(a, conversationId, { type: 'location', locationLat: -16.5, locationLng: -68.1 }).expect(201);
      expect(current.body.data.locationLabel).toBeNull();

      const seen = await history(b, conversationId);
      expect(seen.body.data.map((message: { locationLabel: string | null }) => message.locationLabel)).toEqual([
        'Gimnasio Sopocachi · Av. 20 de Octubre',
        null,
      ]);
      await send(a, conversationId, { type: 'text', body: 'hola', locationLabel: 'no' }).expect(400);
    });
  });

  describe('disappearing messages', () => {
    const setTimer = (account: Account, conversationId: string, seconds: number | null) =>
      request(httpServer)
        .put(url(`/me/conversations/${conversationId}/disappearing`))
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ seconds });

    it('lets either participant change it, notifies both and leaves a notice in the history', async () => {
      const { a, b, conversationId } = await pair();
      const socketA = await joinedSocket(a, conversationId);
      const notice = nextEvent<{ type: string; systemEvent: { kind: string; seconds: number | null; changedByUserId: string } }>(
        socketA,
        'message:new',
      );

      const changed = await setTimer(b, conversationId, 86_400).expect(200);
      expect(changed.body.data).toEqual({ conversationId, disappearingSeconds: 86_400 });
      await expect(notice).resolves.toMatchObject({
        type: 'system',
        systemEvent: { kind: 'DISAPPEARING_MESSAGES_CHANGED', seconds: 86_400, changedByUserId: b.userId },
      });

      // Repetir el mismo modo no duplica el aviso.
      await setTimer(a, conversationId, 86_400).expect(200);
      const summary = await request(httpServer)
        .get(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      const mine = summary.body.data.find((item: { conversationId: string }) => item.conversationId === conversationId);
      expect(mine).toMatchObject({ disappearingSeconds: 86_400, lastMessage: 'Mensajes temporales activados' });

      await setTimer(a, conversationId, null).expect(200);
      const seen = await history(b, conversationId);
      expect(seen.body.data.map((item: { systemEvent?: { seconds: number | null } }) => item.systemEvent?.seconds)).toEqual([
        86_400,
        null,
      ]);
    });

    it('rejects durations other than 24 h, 7 days and 90 days, and outsiders get 404', async () => {
      const { a, conversationId } = await pair();
      const outsider = await register('x');
      await setTimer(a, conversationId, 3600).expect(400);
      await setTimer(outsider, conversationId, 86_400).expect(404);
    });

    it('messages sent while it is on expire for both; earlier ones stay; the purge deletes them', async () => {
      const { a, b, conversationId } = await pair();
      await send(a, conversationId, { type: 'text', body: 'Antes del modo' }).expect(201);
      await setTimer(a, conversationId, 604_800).expect(200);
      const temporary = await send(b, conversationId, { type: 'text', body: 'Temporal' }).expect(201);
      expect(new Date(temporary.body.data.expiresAt).getTime() - Date.now()).toBeGreaterThan(604_000 * 1000);

      // Lo que ya caducó desaparece para ambos aunque la purga no haya pasado.
      await sequelize.query(`UPDATE chat.messages SET expires_at = now() - interval '1 second' WHERE id = :id`, {
        replacements: { id: temporary.body.data.id },
      });
      for (const account of [a, b]) {
        const seen = await history(account, conversationId);
        const bodies = seen.body.data.filter((item: { type: string }) => item.type !== 'system').map((item: { body: string }) => item.body);
        expect(bodies).toEqual(['Antes del modo']);
      }
      await request(httpServer)
        .patch(url(`/me/conversations/${conversationId}/messages/${temporary.body.data.id}`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ body: 'Ya no existe' })
        .expect(404);

      const purged = await application.get(ChatDisappearingPurgeService).purgeOnce();
      expect(purged).toBeGreaterThanOrEqual(1);
      const [rows] = await sequelize.query(`SELECT id FROM chat.messages WHERE id = :id`, {
        replacements: { id: temporary.body.data.id },
      });
      expect(rows).toHaveLength(0);
    });
  });
});
