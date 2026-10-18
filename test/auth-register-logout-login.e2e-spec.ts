import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';

/**
 * Lo que reportó Pablo: «si creas un usuario y entras desde el registro, al
 * cerrar sesión te debería dejar entrar con ese mismo usuario». Se recorre el
 * ciclo completo tal como lo hace el móvil —alta que ya devuelve sesión,
 * cierre con el refresh en el cuerpo, acceso con las mismas credenciales— y
 * se fijan las normalizaciones de las que depende: el correo se compara sin
 * mayúsculas ni espacios, la contraseña byte a byte.
 */
describe('Alta → cierre de sesión → acceso con la misma cuenta (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  const stamp = Date.now();
  // Escrito como lo teclearía alguien en el móvil: mayúsculas y espacios.
  const typedEmail = `  QA-Ciclo-${stamp}@Repp.Test `;
  const storedEmail = `qa-ciclo-${stamp}@repp.test`;
  // Con espacios dentro y en los extremos: son parte de la contraseña.
  const password = ' Clave de prueba 1 ';

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

  const url = (path: string) => `/${env.API_PREFIX}${path}`;
  const login = (email: string, pass: string) =>
    request(httpServer).post(url('/auth/login')).send({ email, password: pass });

  let registrationRefresh = '';

  it('el alta devuelve una sesión completa y guarda el correo normalizado', async () => {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({ email: typedEmail, password, nombreCompleto: 'QA Ciclo', acceptedTerms: true })
      .expect(201);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toHaveLength(64);
    expect(response.body.data.user.email).toBe(storedEmail);
    registrationRefresh = response.body.data.refreshToken as string;
  });

  it('cerrar sesión sin el refresh en el cuerpo es un 400, no un cierre', async () => {
    await request(httpServer).post(url('/auth/logout')).send({}).expect(400);
  });

  it('cerrar sesión con el refresh lo revoca', async () => {
    await request(httpServer)
      .post(url('/auth/logout'))
      .send({ refreshToken: registrationRefresh })
      .expect(204);
    await request(httpServer)
      .post(url('/auth/refresh'))
      .send({ refreshToken: registrationRefresh })
      .expect(401);
  });

  it('después del cierre, la misma cuenta vuelve a entrar con lo que tecleó', async () => {
    const response = await login(typedEmail, password).expect(201);
    expect(response.body.data.user.email).toBe(storedEmail);
    expect(response.body.data.refreshToken).toHaveLength(64);
  });

  it('el correo entra igual en minúsculas y sin espacios', async () => {
    await login(storedEmail, password).expect(201);
  });

  it('la contraseña se compara exacta: recortada o con otra mayúscula no entra', async () => {
    await login(storedEmail, password.trim()).expect(401);
    await login(storedEmail, password.toUpperCase()).expect(401);
  });

  it('una cuenta suspendida con la contraseña correcta recibe 403 con el motivo', async () => {
    const sequelize = application.get(Sequelize);
    await sequelize.query(
      `UPDATE usuarios SET suspended_until = now() + interval '1 day' WHERE email = :email`,
      { replacements: { email: storedEmail } },
    );

    const response = await login(storedEmail, password).expect(403);
    expect(JSON.stringify(response.body)).toMatch(/suspendida/u);

    // Con la contraseña mal sigue siendo el 401 genérico: la suspensión no se
    // revela a quien no ha demostrado ser el dueño.
    await login(storedEmail, 'otra-clave-cualquiera').expect(401);
  });
});
