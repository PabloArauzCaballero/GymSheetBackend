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
 * `GET /me/conversations/pending-replies`: lo que lee el widget «Matches» de la
 * app. Pendiente = match aceptado cuyo último mensaje es de la otra persona, o
 * sin mensajes todavía. Un bloqueo, en cualquier sentido, lo saca.
 */
describe('Pending replies to matches (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  type Account = { accessToken: string; userId: string };

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

  async function registerAccount(label: string): Promise<Account> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `pending-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password: 'e2e-strong-password',
        nombreCompleto: `${label} Apellido`,
        acceptedTerms: true,
      })
      .expect(201);
    return { accessToken: response.body.data.accessToken as string, userId: response.body.data.user.id as string };
  }

  async function match(a: Account, b: Account): Promise<void> {
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

  async function pending(account: Account) {
    const response = await request(httpServer)
      .get(url('/me/conversations/pending-replies'))
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    return response.body.data as {
      count: number;
      oldest: { userId: string; firstName: string; conversationId: string | null; waitingSince: string } | null;
    };
  }

  async function say(from: Account, to: Account, body: string): Promise<string> {
    const started = await request(httpServer)
      .post(url('/me/conversations'))
      .set('Authorization', `Bearer ${from.accessToken}`)
      .send({ otherUserId: to.userId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;
    await request(httpServer)
      .post(url(`/me/conversations/${conversationId}/messages`))
      .set('Authorization', `Bearer ${from.accessToken}`)
      .send({ body })
      .expect(201);
    return conversationId;
  }

  it('requires a session', async () => {
    await request(httpServer).get(url('/me/conversations/pending-replies')).expect(401);
  });

  it('counts a fresh match with no messages for both sides, with first name only', async () => {
    const ana = await registerAccount('Ana');
    const beto = await registerAccount('Beto');
    await match(ana, beto);

    const forAna = await pending(ana);
    expect(forAna.count).toBe(1);
    expect(forAna.oldest).toMatchObject({ userId: beto.userId, firstName: 'Beto' });
    // Aceptar el match ya abre el chat: el widget lleva directo a él.
    expect(typeof forAna.oldest?.conversationId).toBe('string');
    expect((await pending(beto)).oldest?.firstName).toBe('Ana');
  });

  it('follows who spoke last', async () => {
    const carla = await registerAccount('Carla');
    const dani = await registerAccount('Dani');
    await match(carla, dani);

    const conversationId = await say(carla, dani, 'Hola, ¿entrenamos el jueves?');
    expect((await pending(carla)).count).toBe(0);
    const forDani = await pending(dani);
    expect(forDani.count).toBe(1);
    expect(forDani.oldest).toMatchObject({ userId: carla.userId, conversationId });

    await say(dani, carla, 'Dale, a las 7');
    expect((await pending(dani)).count).toBe(0);
    expect((await pending(carla)).count).toBe(1);
  });

  it('drops a match blocked in either direction and never leaks other accounts', async () => {
    const eva = await registerAccount('Eva');
    const fede = await registerAccount('Fede');
    const outsider = await registerAccount('Gus');
    await match(eva, fede);
    await say(fede, eva, '¿Vienes hoy?');
    expect((await pending(eva)).count).toBe(1);
    expect((await pending(outsider)).count).toBe(0);

    await request(httpServer)
      .post(url('/me/blocks'))
      .set('Authorization', `Bearer ${fede.accessToken}`)
      .send({ targetUserId: eva.userId })
      .expect((response) => expect([200, 201]).toContain(response.status));
    expect((await pending(eva)).count).toBe(0);
    expect((await pending(fede)).count).toBe(0);
  });
});
