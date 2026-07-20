import { Logger } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../config/env';
import { databaseMigrations } from './migrations';

const logger = new Logger('DatabaseMigrationRunner');
const migrationLockName = 'gym_sheet_backend_database_migrations';

type MigrationDirection = 'up' | 'down';
type AppliedMigration = { id: string };

function createMigrationConnection(): Sequelize {
  return new Sequelize({
    dialect: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    models: [],
    logging: false,
    dialectOptions: {
      connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      ...(env.DB_SSL
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
            },
          }
        : {}),
    },
    pool: {
      max: 2,
      min: 0,
      acquire: env.DB_POOL_ACQUIRE_MS,
      idle: env.DB_POOL_IDLE_MS,
    },
  });
}

async function ensureMigrationMetadata(sequelize: Sequelize): Promise<void> {
  await sequelize.query('CREATE SCHEMA IF NOT EXISTS app_meta');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
      id varchar(180) PRIMARY KEY,
      description text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function acquireMigrationLock(sequelize: Sequelize): Promise<void> {
  await sequelize.query('SELECT pg_advisory_lock(hashtext(:lockName))', {
    replacements: { lockName: migrationLockName },
  });
}

async function releaseMigrationLock(sequelize: Sequelize): Promise<void> {
  await sequelize.query('SELECT pg_advisory_unlock(hashtext(:lockName))', {
    replacements: { lockName: migrationLockName },
  });
}

async function migrateUp(sequelize: Sequelize): Promise<void> {
  const appliedMigrations = await sequelize.query<AppliedMigration>(
    'SELECT id FROM app_meta.schema_migrations ORDER BY id ASC',
    { type: QueryTypes.SELECT },
  );
  const appliedIdentifiers = new Set(appliedMigrations.map(({ id }) => id));

  for (const migration of databaseMigrations) {
    if (appliedIdentifiers.has(migration.id)) {
      continue;
    }

    logger.log({ event: 'migration.started', migrationId: migration.id });
    await sequelize.transaction(async (transaction) => {
      await migration.up(sequelize.getQueryInterface(), transaction);
      await sequelize.query(
        `INSERT INTO app_meta.schema_migrations (id, description)
         VALUES (:id, :description)`,
        {
          replacements: { id: migration.id, description: migration.description },
          transaction,
        },
      );
    });
    logger.log({ event: 'migration.completed', migrationId: migration.id });
  }
}

async function migrateDown(sequelize: Sequelize): Promise<void> {
  const [latestAppliedMigration] = await sequelize.query<AppliedMigration>(
    'SELECT id FROM app_meta.schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1',
    { type: QueryTypes.SELECT },
  );

  if (!latestAppliedMigration) {
    logger.log({ event: 'migration.noop', reason: 'no_applied_migrations' });
    return;
  }

  const migration = databaseMigrations.find(
    ({ id }) => id === latestAppliedMigration.id,
  );

  if (!migration) {
    throw new Error(
      `Applied migration ${latestAppliedMigration.id} is missing from the code registry.`,
    );
  }

  logger.warn({ event: 'migration.rollback_started', migrationId: migration.id });
  await sequelize.transaction(async (transaction) => {
    await migration.down(sequelize.getQueryInterface(), transaction);
    await sequelize.query('DELETE FROM app_meta.schema_migrations WHERE id = :id', {
      replacements: { id: migration.id },
      transaction,
    });
  });
  logger.warn({ event: 'migration.rollback_completed', migrationId: migration.id });
}

export async function runMigrations(direction: MigrationDirection): Promise<void> {
  const sequelize = createMigrationConnection();
  let lockAcquired = false;

  try {
    await sequelize.authenticate();
    await ensureMigrationMetadata(sequelize);
    await acquireMigrationLock(sequelize);
    lockAcquired = true;

    if (direction === 'down') {
      await migrateDown(sequelize);
    } else {
      await migrateUp(sequelize);
    }
  } finally {
    if (lockAcquired) {
      try {
        await releaseMigrationLock(sequelize);
      } catch {
        logger.warn({ event: 'migration.lock_release_failed' });
      }
    }
    await sequelize.close();
  }
}

function parseDirection(rawDirection: string | undefined): MigrationDirection {
  const direction = rawDirection ?? 'up';

  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Migration direction must be "up" or "down".');
  }

  return direction;
}

void runMigrations(parseDirection(process.argv[2])).catch((error: unknown) => {
  logger.error(
    {
      event: 'migration.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
  );
  process.exitCode = 1;
});
