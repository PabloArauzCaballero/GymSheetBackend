import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const expressApplication = application.getHttpAdapter().getInstance();

  expressApplication.disable('x-powered-by');

  if (env.TRUST_PROXY) {
    expressApplication.set('trust proxy', 1);
  }

  application.setGlobalPrefix(env.API_PREFIX);
  application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
  application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
  application.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
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
