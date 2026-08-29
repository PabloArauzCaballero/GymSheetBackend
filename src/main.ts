import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Express, json, static as expressStatic, urlencoded } from 'express';
import helmet from 'helmet';
import { resolve } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { env } from './config/env';
import { bootstrapDatabase } from './database/database-bootstrap';

async function bootstrap(): Promise<void> {
  await bootstrapDatabase();
  const application = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  // Nest types `getInstance()` as `any`; the adapter is Express in this build.
  const expressApplication = application
    .getHttpAdapter()
    .getInstance() as Express;

  expressApplication.disable('x-powered-by');

  if (env.TRUST_PROXY) {
    expressApplication.set('trust proxy', 1);
  }

  application.setGlobalPrefix(env.API_PREFIX);

  application.use(requestIdMiddleware);
  // helmet y CORS van ANTES de los parsers de cuerpo y de cualquier montaje
  // estático: un 413 por `REQUEST_BODY_LIMIT` o un 400 por JSON malformado los
  // emite el parser, y con helmet detrás esas respuestas salían sin `nosniff`,
  // sin CSP y sin CORP.
  application.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Local media adapter: serve the on-disk root under its public base path.
  // Only the `local` provider is served in-process; remote providers serve
  // their own assets. Mounted before the global prefix (static, not a route).
  //
  // Va DESPUÉS de helmet a propósito. Montado antes, este directorio —el único
  // contenido que suben los usuarios— se servía sin una sola cabecera de
  // contención, mientras el resto de la API sí las tenía. Las cabeceras de
  // abajo lo tratan como lo que es: bytes ajenos que el navegador nunca debe
  // interpretar como documento activo.
  if (env.MEDIA_STORAGE_PROVIDER === 'local') {
    const mediaMountPath = new URL(env.MEDIA_STORAGE_PUBLIC_BASE_URL).pathname;
    expressApplication.use(
      mediaMountPath,
      expressStatic(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), {
        setHeaders: (response) => {
          // Sin sniffing: el navegador respeta el Content-Type derivado de la
          // extensión, que ahora sólo puede salir de `MIME_EXTENSION`.
          response.setHeader('X-Content-Type-Options', 'nosniff');
          // Descarga, nunca renderizado en el origen de la API.
          response.setHeader('Content-Disposition', 'attachment');
          // Defensa en profundidad: aunque algo llegara a interpretarse como
          // documento, no puede cargar ni ejecutar nada.
          response.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; sandbox",
          );
        },
      }),
    );
  }

  application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
  application.use(
    urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }),
  );
  application.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  application.useGlobalFilters(new HttpExceptionFilter());
  application.useGlobalInterceptors(new ResponseInterceptor());
  application.enableShutdownHooks();

  await application.listen(env.PORT, '0.0.0.0');

  Logger.log(
    {
      event: 'application.started',
      port: env.PORT,
      apiPrefix: env.API_PREFIX,
      environment: env.NODE_ENV,
    },
    'Bootstrap',
  );
}

void bootstrap();
