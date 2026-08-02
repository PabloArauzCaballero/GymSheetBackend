import { Logger } from '@nestjs/common';
import { env } from '../config/env';
import { runMigrations } from './migrate';
import { runSeeds, SeedMode } from './seeders/seed';

const logger = new Logger('DatabaseBootstrap');

export function startupSeedMode(
  nodeEnvironment: string = env.NODE_ENV,
): SeedMode {
  return nodeEnvironment === 'development' ? 'all' : 'base';
}

/** Applies the complete, idempotent database lifecycle before Nest starts. */
export async function bootstrapDatabase(): Promise<void> {
  logger.log({
    event: 'database.bootstrap.started',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
  });
  await runMigrations('up');
  await runSeeds(startupSeedMode());
  logger.log({
    event: 'database.bootstrap.completed',
    seedMode: startupSeedMode(),
  });
}
