import { Logger, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { env } from '../config/env';
import { databaseModels } from './models';

const databaseLogger = new Logger('Sequelize');

/**
 * Sequelize receives these options through the PostgreSQL `pg` client.
 * Timeouts bound connection and statement resource usage in production.
 */
const dialectOptions = {
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
};

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      models: databaseModels,
      autoLoadModels: false,
      synchronize: false,
      benchmark: env.DB_LOGGING,
      logging: env.DB_LOGGING
        ? (sqlStatement, elapsedMilliseconds) =>
            databaseLogger.debug({
              event: 'database.query',
              elapsedMilliseconds,
              sqlStatement,
            })
        : false,
      dialectOptions,
      pool: {
        max: env.DB_POOL_MAX,
        min: env.DB_POOL_MIN,
        acquire: env.DB_POOL_ACQUIRE_MS,
        idle: env.DB_POOL_IDLE_MS,
        evict: env.DB_POOL_IDLE_MS,
      },
    }),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}
