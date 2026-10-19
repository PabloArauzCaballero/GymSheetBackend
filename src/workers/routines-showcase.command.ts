import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { env } from '../config/env';
import { assertShowcaseAllowed, runRoutinesShowcase } from '../database/seeders/showcase/routines-showcase.seed';
import { AppModule } from '../app.module';

/**
 * Datos de demostración de rutinas (10_CORRECCIONES §C6/§C7).
 *
 *   SEED_SHOWCASE_PASSWORD=… yarn db:seed:showcase        # desarrollo (ts-node)
 *   SEED_SHOWCASE_PASSWORD=… yarn db:seed:showcase:prod   # imagen construida (TEST)
 *
 * Idempotente. NO corre al arrancar el contenedor: se lanza a mano. Prohibido
 * con NODE_ENV=production.
 */
async function main(): Promise<void> {
  assertShowcaseAllowed(env.NODE_ENV);
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.flushLogs();
  try {
    await runRoutinesShowcase(app);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    {
      event: 'database.seed.showcase.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'RoutinesShowcaseSeed',
  );
  process.exitCode = 1;
});
