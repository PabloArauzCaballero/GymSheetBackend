/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access --
   supertest tipa las respuestas como `any`; este ayudante solo las reenvía a las pruebas. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { env } from '../../src/config/env';

export type E2eApp = {
  app: INestApplication;
  http: Parameters<typeof request>[0];
  url: (path: string) => string;
  register: (label: string) => Promise<{ token: string; id: string }>;
  /** Cambia el rol en la base (la sesión se revalida contra la base en cada petición). */
  promote: (userId: string, role: 'ADMIN' | 'SYSTEM_ADMIN' | 'COACH') => Promise<void>;
  /** SQL de apoyo para preparar o inspeccionar estado que la API no expone. */
  sql: (statement: string, replacements?: Record<string, unknown>) => Promise<void>;
  as: (token: string) => {
    get: (path: string) => request.Test;
    post: (path: string) => request.Test;
    put: (path: string) => request.Test;
    patch: (path: string) => request.Test;
    del: (path: string) => request.Test;
  };
};

const password = 'e2e-strong-password';

/** Arranca la app completa contra la base de pruebas, igual que main.ts. */
export async function bootE2eApp(): Promise<E2eApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.setGlobalPrefix(env.API_PREFIX);
  app.use(requestIdMiddleware);
  app.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
  app.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  const http = app.getHttpServer();
  const url = (path: string) => `/${env.API_PREFIX}${path}`;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    app,
    http,
    url,
    register: async (label) => {
      const response = await request(http)
        .post(url('/auth/register'))
        .send({
          email: `${label}-${suffix}@example.test`,
          password,
          nombreCompleto: `E2E ${label}`,
          acceptedTerms: true,
        })
        .expect(201);
      const token = response.body.data.accessToken as string;
      const me = await request(http).get(url('/auth/me')).set('Authorization', `Bearer ${token}`);
      return { token, id: (me.body.data?.id ?? me.body.data?.usuario?.id) as string };
    },
    promote: async (userId, role) => {
      await app.get(Sequelize).query('UPDATE public.usuarios SET rol = :role WHERE id = :userId', {
        replacements: { role, userId },
      });
    },
    sql: async (statement, replacements = {}) => {
      await app.get(Sequelize).query(statement, { replacements });
    },
    as: (token) => {
      const auth = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);
      return {
        get: (path) => auth(request(http).get(url(path))),
        post: (path) => auth(request(http).post(url(path))),
        put: (path) => auth(request(http).put(url(path))),
        patch: (path) => auth(request(http).patch(url(path))),
        del: (path) => auth(request(http).delete(url(path))),
      };
    },
  };
}

/** Crea un ejercicio personal y devuelve su id. */
export async function createPersonalExercise(
  api: ReturnType<E2eApp['as']>,
  nombre: string,
): Promise<string> {
  const response = await api
    .post('/exercises/personal')
    .send({ nombre, grupoMuscular: 'Pecho' });
  if (response.status !== 201) {
    throw new Error(`createPersonalExercise ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body.data.id as string;
}
