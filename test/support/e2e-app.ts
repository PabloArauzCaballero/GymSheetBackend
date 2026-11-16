/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access --
   supertest tipa las respuestas como `any`; este ayudante solo las reenvía a las pruebas. */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { env } from '../../src/config/env';
import { LEGAL_DOCUMENTS } from '../../src/modules/legal/legal-documents';

export type E2eApp = {
  app: INestApplication;
  http: Parameters<typeof request>[0];
  url: (path: string) => string;
  /**
   * Registers a member. The email is verified directly in the database unless
   * `verifyEmail: false`, because most suites exercise social routes, which
   * require a verified email (the PIN flow has its own e2e spec).
   */
  register: (label: string, options?: { verifyEmail?: boolean }) => Promise<{ token: string; id: string }>;
  /** Cambia el rol en la base (la sesión se revalida contra la base en cada petición). */
  promote: (userId: string, role: 'ADMIN' | 'SYSTEM_ADMIN' | 'MODERATOR' | 'COACH' | 'FRONT_DESK') => Promise<void>;
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

/**
 * Fields every signup must send: sex (MALE|FEMALE), an adult birth date and
 * the terms version the client showed. Spread into each register body.
 */
export const E2E_SIGNUP_FIELDS = {
  acceptedTerms: true,
  genero: 'MALE',
  fechaNacimiento: '1995-05-15',
  termsVersion: LEGAL_DOCUMENTS.TERMS,
} as const;

/**
 * Marks the account's email as verified straight in the database, the state a
 * confirmed PIN leaves. For suites that post `/auth/register` themselves and
 * then use social routes (`@RequiresVerifiedEmail`).
 */
export async function markEmailVerified(app: INestApplication, userId: string): Promise<void> {
  await app.get(Sequelize).query(
    'UPDATE public.usuarios SET email_verified_at = now() WHERE id = :userId AND email_verified_at IS NULL',
    { replacements: { userId } },
  );
}

/** Arranca la app completa contra la base de pruebas, igual que main.ts. */
export async function bootE2eApp(
  /** Optional provider overrides, e.g. a stubbed outbound fetcher. */
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<E2eApp> {
  const moduleRef = await configure(Test.createTestingModule({ imports: [AppModule] })).compile();
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
    register: async (label, options = {}) => {
      // The real client path: fetch a form ticket first (SIGNUP_MIN_FILL_MS is 0 in e2e).
      const ticketResponse = await request(http).get(url('/auth/register/ticket')).expect(200);
      const response = await request(http)
        .post(url('/auth/register'))
        .send({
          ticket: ticketResponse.body.data.ticket as string,
          email: `${label}-${suffix}@example.test`,
          password,
          nombreCompleto: `E2E ${label}`,
          ...E2E_SIGNUP_FIELDS,
        })
        .expect(201);
      const token = response.body.data.accessToken as string;
      const me = await request(http).get(url('/auth/me')).set('Authorization', `Bearer ${token}`);
      const id = (me.body.data?.id ?? me.body.data?.usuario?.id) as string;
      if (options.verifyEmail !== false) await markEmailVerified(app, id);
      return { token, id };
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
