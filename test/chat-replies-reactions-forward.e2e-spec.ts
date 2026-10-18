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
import { readFileSync } from 'fs';
import { join } from 'path';

type Account = { accessToken: string; userId: string };

// Cada caso registra y conecta dos cuentas reales: el plazo por defecto (5 s) no alcanza.
jest.setTimeout(30000);

/**
 * Chat como WhatsApp (2026-10-18): responder citando, reacciones, reenviar y
 * «escribiendo…». Contra PostgreSQL real y con el socket escuchando.
 */
describe('Chat: replies, reactions, forward and typing (e2e)', () => {
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
        email: `chatwa-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password: 'e2e-strong-password',
        nombreCompleto: `ChatWA ${label}`,
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
    const joinAck = await new Promise<{ joined: boolean }>((resolve) => socket.emit('conversation:join', { conversationId }, resolve));
    // Unirse justo tras `connect` tiene que funcionar: es lo que hace el móvil.
    expect(joinAck).toEqual({ joined: true });
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

  const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
  const react = (account: Account, conversationId: string, messageId: string, emoji: string | null) =>
    request(httpServer)
      .put(url(`/me/conversations/${conversationId}/messages/${messageId}/reaction`))
      .set(auth(account))
      .send({ emoji });
  const forward = (account: Account, toConversationId: string, fromConversationId: string, messageId: string) =>
    request(httpServer)
      .post(url(`/me/conversations/${toConversationId}/messages/forward`))
      .set(auth(account))
      .send({ fromConversationId, messageId });
  const photo = readFileSync(join(__dirname, '../src/modules/chat/fixtures/gps-orientation.jpg'));
  const sendPhoto = (account: Account, conversationId: string, fields: Record<string, string>) => {
    let call = request(httpServer)
      .post(url(`/me/conversations/${conversationId}/messages/media`))
      .set(auth(account))
      .attach('file', photo, { filename: 'foto.jpg', contentType: 'image/jpeg' })
      .field('type', 'image');
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call;
  };

  /** Una tercera persona conectada con `a`, con su propia conversación. */
  async function thirdConversation(a: Account): Promise<{ c: Account; conversationId: string }> {
    const c = await register('c');
    const sent = await request(httpServer).post(url('/me/connections')).set(auth(a)).send({ addresseeId: c.userId }).expect(201);
    await request(httpServer).patch(url(`/me/connections/${sent.body.data.id}`)).set(auth(c)).send({ action: 'ACCEPT' }).expect(200);
    const started = await request(httpServer).post(url('/me/conversations')).set(auth(a)).send({ otherUserId: c.userId }).expect(201);
    return { c, conversationId: started.body.data.conversationId };
  }

  describe('quoted replies', () => {
    it('sends a reply with its quote, over REST, socket and multipart, and the history keeps it', async () => {
      const { a, b, conversationId } = await pair();
      const original = await send(a, conversationId, { type: 'text', body: '¿Piernas mañana a las 7?' }).expect(201);
      const socketA = await joinedSocket(a, conversationId);
      const socketB = await joinedSocket(b, conversationId);

      const incoming = nextEvent<{ replyTo: unknown }>(socketA, 'message:new');
      const reply = await send(b, conversationId, { type: 'text', body: 'Hecho', replyToId: original.body.data.id }).expect(201);
      const quote = {
        messageId: original.body.data.id, senderId: a.userId, type: 'text', body: '¿Piernas mañana a las 7?', available: true,
      };
      expect(reply.body.data.replyTo).toEqual(quote);
      await expect(incoming).resolves.toMatchObject({ replyTo: quote });

      const ack = await new Promise<{ ok: boolean; messageId: string }>((resolve) =>
        socketB.emit('message:send', { conversationId, body: 'Y llevo cinturón', replyToId: original.body.data.id }, resolve));
      expect(ack.ok).toBe(true);

      const withPhoto = await sendPhoto(b, conversationId, { replyToId: original.body.data.id, body: 'Así quedó' }).expect(201);
      expect(withPhoto.body.data.replyTo).toMatchObject({ messageId: original.body.data.id, available: true });

      const page = (await history(a, conversationId)).body.data as Array<{ id: string; replyTo: unknown }>;
      expect(page.find((item) => item.id === reply.body.data.id)?.replyTo).toEqual(quote);
      expect(page.find((item) => item.id === ack.messageId)?.replyTo).toEqual(quote);
      expect(page.find((item) => item.id === original.body.data.id)?.replyTo).toBeNull();
    });

    it('rejects quoting a message from another conversation, and shows a deleted original as unavailable', async () => {
      const { a, b, conversationId } = await pair();
      const { conversationId: otherConversationId } = await thirdConversation(a);
      const elsewhere = await send(a, otherConversationId, { type: 'text', body: 'secreto' }).expect(201);
      const refused = await send(a, conversationId, { type: 'text', body: 'cita ajena', replyToId: elsewhere.body.data.id }).expect(400);
      expect(JSON.stringify(refused.body)).toContain('El mensaje al que respondes ya no está disponible.');

      const original = await send(a, conversationId, { type: 'text', body: 'me arrepiento' }).expect(201);
      const reply = await send(b, conversationId, { type: 'text', body: '¿qué?', replyToId: original.body.data.id }).expect(201);
      await request(httpServer)
        .delete(url(`/me/conversations/${conversationId}/messages/${original.body.data.id}?scope=EVERYONE`))
        .set(auth(a))
        .expect(200);
      const page = (await history(b, conversationId)).body.data as Array<{ id: string; replyTo: unknown }>;
      expect(page.find((item) => item.id === reply.body.data.id)?.replyTo).toEqual({
        messageId: original.body.data.id, senderId: a.userId, type: 'text', body: null, available: false,
      });
      await send(b, conversationId, { type: 'text', body: 'tarde', replyToId: original.body.data.id }).expect(400);
    });
  });

  describe('reactions', () => {
    it('reacts, changes and removes one reaction per person, emitting message:reaction', async () => {
      const { a, b, conversationId } = await pair();
      const socketA = await joinedSocket(a, conversationId);
      const sent = await send(a, conversationId, { type: 'text', body: 'PR en sentadilla' }).expect(201);
      const messageId = sent.body.data.id as string;

      const event = nextEvent<{ messageId: string; reactions: unknown }>(socketA, 'message:reaction');
      const first = await react(b, conversationId, messageId, '🔥').expect(200);
      expect(first.body.data).toEqual({ conversationId, messageId, reactions: [{ userId: b.userId, emoji: '🔥' }] });
      await expect(event).resolves.toEqual(first.body.data);

      await react(b, conversationId, messageId, '👍').expect(200);
      const both = await react(a, conversationId, messageId, '❤️').expect(200);
      expect(both.body.data.reactions).toEqual([{ userId: b.userId, emoji: '👍' }, { userId: a.userId, emoji: '❤️' }]);

      const page = (await history(a, conversationId)).body.data as Array<{ id: string; reactions: unknown }>;
      expect(page.find((item) => item.id === messageId)?.reactions).toEqual(both.body.data.reactions);

      const removed = await react(b, conversationId, messageId, null).expect(200);
      expect(removed.body.data.reactions).toEqual([{ userId: a.userId, emoji: '❤️' }]);
      await react(b, conversationId, messageId, 'hola').expect(400);
    });

    it('answers 404 for a message hidden for the caller or outside their conversations', async () => {
      const { a, b, conversationId } = await pair();
      const sent = await send(a, conversationId, { type: 'text', body: 'ocúltalo' }).expect(201);
      await request(httpServer)
        .delete(url(`/me/conversations/${conversationId}/messages/${sent.body.data.id}?scope=ME`))
        .set(auth(b))
        .expect(200);
      await react(b, conversationId, sent.body.data.id, '👍').expect(404);

      const outsider = await register('x');
      await react(outsider, conversationId, sent.body.data.id, '👍').expect(404);
    });

    it('deleting for everyone clears the reactions', async () => {
      const { a, b, conversationId } = await pair();
      const sent = await send(a, conversationId, { type: 'text', body: 'ups' }).expect(201);
      await react(b, conversationId, sent.body.data.id, '😂').expect(200);
      await request(httpServer)
        .delete(url(`/me/conversations/${conversationId}/messages/${sent.body.data.id}?scope=EVERYONE`))
        .set(auth(a))
        .expect(200);
      const rows = await sequelize.query('SELECT 1 FROM chat.message_reactions WHERE message_id = :id', {
        replacements: { id: sent.body.data.id },
      });
      expect(rows[0]).toHaveLength(0);
      const page = (await history(b, conversationId)).body.data as Array<{ id: string; reactions: unknown }>;
      expect(page.find((item) => item.id === sent.body.data.id)?.reactions).toEqual([]);
      await react(b, conversationId, sent.body.data.id, '😂').expect(404);
    });
  });

  describe('forwarding', () => {
    it('forwards a text and a photo as new «forwarded» messages with their own media', async () => {
      const { a, conversationId } = await pair();
      const { c, conversationId: targetId } = await thirdConversation(a);
      const socketC = await joinedSocket(c, targetId);

      const text = await send(a, conversationId, { type: 'text', body: 'Rutina de empuje' }).expect(201);
      const incoming = nextEvent<{ forwarded: boolean; body: string }>(socketC, 'message:new');
      const forwarded = await forward(a, targetId, conversationId, text.body.data.id).expect(201);
      expect(forwarded.body.data).toMatchObject({ conversationId: targetId, body: 'Rutina de empuje', forwarded: true, replyTo: null });
      await expect(incoming).resolves.toMatchObject({ forwarded: true, body: 'Rutina de empuje' });

      const picture = await sendPhoto(a, conversationId, { body: 'técnica' }).expect(201);
      const copy = await forward(a, targetId, conversationId, picture.body.data.id).expect(201);
      expect(copy.body.data).toMatchObject({ type: 'image', body: 'técnica', forwarded: true, viewOnce: false });
      const keys = await sequelize.query<{ id: string; media_key: string }>(
        'SELECT id, media_key FROM chat.messages WHERE id IN (:ids)',
        { replacements: { ids: [picture.body.data.id, copy.body.data.id] }, type: 'SELECT' as never },
      );
      expect(new Set(keys.map((row) => row.media_key)).size).toBe(2);

      const download = await request(httpServer).get(url(copy.body.data.mediaUrl as string)).set(auth(c)).expect(200);
      const original = await request(httpServer).get(url(picture.body.data.mediaUrl as string)).set(auth(a)).expect(200);
      expect(Buffer.compare(download.body as Buffer, original.body as Buffer)).toBe(0);
    });

    it('refuses view-once media, foreign conversations and messages the caller cannot see', async () => {
      const { a, b, conversationId } = await pair();
      const { conversationId: targetId } = await thirdConversation(a);
      const once = await sendPhoto(a, conversationId, { viewOnce: 'true' }).expect(201);
      const refused = await forward(a, targetId, conversationId, once.body.data.id).expect(400);
      expect(JSON.stringify(refused.body)).toContain('Los mensajes de vista única no se pueden reenviar.');

      const text = await send(a, conversationId, { type: 'text', body: 'solo nuestro' }).expect(201);
      // b no participa en la conversación destino.
      await forward(b, targetId, conversationId, text.body.data.id).expect(404);
    });
  });

  describe('typing', () => {
    it('relays typing to the other participant only', async () => {
      const { a, b, conversationId } = await pair();
      const socketA = await joinedSocket(a, conversationId);
      const socketB = await joinedSocket(b, conversationId);
      let echoed = false;
      socketA.on('typing:update', () => { echoed = true; });
      const update = nextEvent<{ conversationId: string; userId: string; typing: boolean }>(socketB, 'typing:update');
      const ack = await new Promise<{ ok: boolean }>((resolve) => socketA.emit('typing', { conversationId, typing: true }, resolve));
      expect(ack).toEqual({ ok: true });
      await expect(update).resolves.toEqual({ conversationId, userId: a.userId, typing: true });
      expect(echoed).toBe(false);

      const { c, conversationId: otherId } = await thirdConversation(a);
      expect(c.userId).toBeTruthy();
      const foreign = await new Promise<{ ok: boolean }>((resolve) => socketB.emit('typing', { conversationId: otherId, typing: true }, resolve));
      expect(foreign).toEqual({ ok: false });
    });
  });
});
