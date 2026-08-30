import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/**
 * Punto 5 del audit: chat entre socios conectados. Cubre el camino REST
 * (historial, envío de respaldo) y, por separado, el socket en vivo — que es
 * la parte que un e2e sobre `supertest` nunca alcanzaría a probar por sí solo.
 */
describe('Chat between connections (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let baseUrl: string;

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

    // El socket necesita un puerto real escuchando; los demás e2e de este
    // repo usan `getHttpServer()` sin escuchar porque supertest no lo exige.
    await application.listen(0);
    const address = application.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' ? address?.port : 0}`;
    httpServer = application.getHttpServer();
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  async function registerAccount(label: string): Promise<{ accessToken: string; userId: string }> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `chat-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Chat ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return {
      accessToken: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  }

  async function connectAccounts(
    a: { accessToken: string; userId: string },
    b: { accessToken: string; userId: string },
  ): Promise<void> {
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
  }

  describe('REST', () => {
    it('refuses to start a conversation without an accepted connection', async () => {
      const a = await registerAccount('rest-a');
      const b = await registerAccount('rest-b');
      await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ otherUserId: b.userId })
        .expect(403);
    });

    it('starts a conversation once connected, sends a message, and reads it back', async () => {
      const a = await registerAccount('rest-c');
      const b = await registerAccount('rest-d');
      await connectAccounts(a, b);

      const started = await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ otherUserId: b.userId })
        .expect(201);
      const conversationId = started.body.data.conversationId as string;

      await request(httpServer)
        .post(url(`/me/conversations/${conversationId}/messages`))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ body: 'Hola, ¿entrenamos juntos?' })
        .expect(201);

      const history = await request(httpServer)
        .get(url(`/me/conversations/${conversationId}/messages`))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(history.body.data).toHaveLength(1);
      expect(history.body.data[0].body).toBe('Hola, ¿entrenamos juntos?');

      const list = await request(httpServer)
        .get(url('/me/conversations'))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(list.body.data[0].lastMessage).toBe('Hola, ¿entrenamos juntos?');
    });

    it('refuses to read messages from a conversation the caller is not part of', async () => {
      const a = await registerAccount('rest-e');
      const b = await registerAccount('rest-f');
      const outsider = await registerAccount('rest-g');
      await connectAccounts(a, b);
      const started = await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ otherUserId: b.userId })
        .expect(201);

      await request(httpServer)
        .get(url(`/me/conversations/${started.body.data.conversationId}/messages`))
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
    });

    it('reuses the same conversation on a second start instead of creating a duplicate', async () => {
      const a = await registerAccount('rest-h');
      const b = await registerAccount('rest-i');
      await connectAccounts(a, b);

      const first = await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ otherUserId: b.userId })
        .expect(201);
      const second = await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ otherUserId: a.userId })
        .expect(201);

      expect(second.body.data.conversationId).toBe(first.body.data.conversationId);
    });
  });

  describe('WebSocket', () => {
    async function issueTicket(accessToken: string): Promise<string> {
      const response = await request(httpServer)
        .post(url('/auth/socket-ticket'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      return response.body.data.ticket as string;
    }

    async function connectSocket(accessToken: string): Promise<Socket> {
      const ticket = await issueTicket(accessToken);
      return new Promise((resolve, reject) => {
        const socket = io(`${baseUrl}/chat`, { auth: { ticket }, transports: ['websocket'] });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    }

    it('disconnects a socket that never proved who it is', async () => {
      // El handshake de transporte de Socket.IO se completa antes de que
      // `handleConnection` corra: un socket sin boleto sí puede llegar a
      // emitir "connect", pero el servidor lo desconecta enseguida después.
      // Lo que se prueba es que termina desconectado, no que nunca conecte.
      await expect(
        new Promise((resolve, reject) => {
          const socket = io(`${baseUrl}/chat`, { transports: ['websocket'] });
          socket.once('disconnect', () => resolve(undefined));
          socket.once('connect_error', () => resolve(undefined));
          setTimeout(() => reject(new Error('timed out waiting for disconnect')), 5000);
        }),
      ).resolves.toBeUndefined();
    }, 10000);

    it('rejects a socket ticket that was already used to connect', async () => {
      const a = await registerAccount('ws-ticket');
      const ticket = await issueTicket(a.accessToken);

      const first = await new Promise<Socket>((resolve, reject) => {
        const socket = io(`${baseUrl}/chat`, { auth: { ticket }, transports: ['websocket'] });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });

      try {
        await expect(
          new Promise((resolve, reject) => {
            const socket = io(`${baseUrl}/chat`, { auth: { ticket }, transports: ['websocket'] });
            socket.once('disconnect', () => resolve(undefined));
            socket.once('connect_error', () => resolve(undefined));
            setTimeout(() => reject(new Error('timed out waiting for rejection')), 5000);
          }),
        ).resolves.toBeUndefined();
      } finally {
        first.disconnect();
      }
    }, 10000);

    it('delivers a message sent over the socket to the other participant in real time', async () => {
      const a = await registerAccount('ws-a');
      const b = await registerAccount('ws-b');
      await connectAccounts(a, b);
      const started = await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ otherUserId: b.userId })
        .expect(201);
      const conversationId = started.body.data.conversationId as string;

      const socketA = await connectSocket(a.accessToken);
      const socketB = await connectSocket(b.accessToken);
      try {
        await Promise.all([
          new Promise((resolve) => socketA.emit('conversation:join', { conversationId }, resolve)),
          new Promise((resolve) => socketB.emit('conversation:join', { conversationId }, resolve)),
        ]);

        const received = new Promise((resolve) => {
          socketB.once('message:new', resolve);
        });

        await new Promise((resolve, reject) => {
          socketA.emit(
            'message:send',
            { conversationId, body: 'Nos vemos en la sede a las 6' },
            (ack: { ok: boolean; error?: string }) => (ack.ok ? resolve(ack) : reject(new Error(ack.error))),
          );
        });

        const message = (await received) as { body: string; senderId: string };
        expect(message.body).toBe('Nos vemos en la sede a las 6');
        expect(message.senderId).toBe(a.userId);
      } finally {
        socketA.disconnect();
        socketB.disconnect();
      }
    }, 15000);

    it('does not deliver a message to someone who never joined the conversation room', async () => {
      const a = await registerAccount('ws-c');
      const b = await registerAccount('ws-d');
      const outsider = await registerAccount('ws-e');
      await connectAccounts(a, b);
      const started = await request(httpServer)
        .post(url('/me/conversations'))
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ otherUserId: b.userId })
        .expect(201);
      const conversationId = started.body.data.conversationId as string;

      const socketA = await connectSocket(a.accessToken);
      const socketOutsider = await connectSocket(outsider.accessToken);
      try {
        await new Promise((resolve) => socketA.emit('conversation:join', { conversationId }, resolve));
        // El intruso intenta unirse a una conversación de la que no es parte:
        // el gateway lo ignora en silencio, sin sala a la que unirse.
        await new Promise((resolve) => socketOutsider.emit('conversation:join', { conversationId }, resolve));

        let outsiderReceived = false;
        socketOutsider.on('message:new', () => {
          outsiderReceived = true;
        });

        await new Promise((resolve, reject) => {
          socketA.emit(
            'message:send',
            { conversationId, body: 'mensaje privado' },
            (ack: { ok: boolean; error?: string }) => (ack.ok ? resolve(ack) : reject(new Error(ack.error))),
          );
        });
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(outsiderReceived).toBe(false);
      } finally {
        socketA.disconnect();
        socketOutsider.disconnect();
      }
    }, 15000);
  });
});
