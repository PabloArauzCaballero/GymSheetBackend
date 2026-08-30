import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/** Punto 16 del audit: no existía ni avatar único; esta es la galería de fotos de perfil. */
describe('Profile photos (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  const password = 'e2e-strong-password';
  // 1x1 PNG transparente — el multipart más pequeño que sigue siendo una imagen real.
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

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
        email: `photos-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Fotos ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  it('starts with an empty gallery', async () => {
    const accessToken = await registerAccount('empty');

    const response = await request(httpServer)
      .get(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('uploads a photo and lists it back', async () => {
    const accessToken = await registerAccount('upload');

    const uploadResponse = await request(httpServer)
      .post(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', tinyPng, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadResponse.body.data.url).toEqual(expect.any(String));
    expect(uploadResponse.body.data.posicion).toBe(0);

    const list = await request(httpServer)
      .get(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(uploadResponse.body.data.id);
  });

  it('rejects a non-image upload', async () => {
    const accessToken = await registerAccount('non-image');

    await request(httpServer)
      .post(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('deletes a photo, and a second delete reports it as already gone', async () => {
    const accessToken = await registerAccount('delete');
    const uploadResponse = await request(httpServer)
      .post(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', tinyPng, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201);
    const photoId = uploadResponse.body.data.id as string;

    await request(httpServer)
      .delete(url(`/me/photos/${photoId}`))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const list = await request(httpServer)
      .get(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.data).toEqual([]);

    await request(httpServer)
      .delete(url(`/me/photos/${photoId}`))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('does not let one account delete or see another account\'s photo', async () => {
    const ownerToken = await registerAccount('owner');
    const intruderToken = await registerAccount('intruder');
    const uploadResponse = await request(httpServer)
      .post(url('/me/photos'))
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', tinyPng, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201);
    const photoId = uploadResponse.body.data.id as string;

    await request(httpServer)
      .delete(url(`/me/photos/${photoId}`))
      .set('Authorization', `Bearer ${intruderToken}`)
      .expect(404);

    const ownerList = await request(httpServer)
      .get(url('/me/photos'))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ownerList.body.data).toHaveLength(1);
  });

  it('rejects a seventh photo for the same account', async () => {
    const accessToken = await registerAccount('limit');
    for (let index = 0; index < 6; index += 1) {
      await request(httpServer)
        .post(url('/me/photos'))
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', tinyPng, { filename: `avatar-${index}.png`, contentType: 'image/png' })
        .expect(201);
    }

    await request(httpServer)
      .post(url('/me/photos'))
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', tinyPng, { filename: 'avatar-7.png', contentType: 'image/png' })
      .expect(400);
  });
});
