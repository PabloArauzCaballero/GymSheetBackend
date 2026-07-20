import { ServiceUnavailableException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { OptionalRedisClient } from '../../common/redis/redis.module';
import { databaseMigrations } from '../../database/migrations';
import { HealthService } from './health.service';

const allMigrationIds = databaseMigrations.map((migration) => ({ id: migration.id }));

/**
 * Readiness issues two queries: the connectivity probe and the migration
 * registry read. This builds a Sequelize double that answers them in order.
 */
function createSequelize(appliedMigrations: { id: string }[]): Sequelize {
  return {
    query: jest
      .fn()
      .mockResolvedValueOnce([{ ready: 1 }])
      .mockResolvedValueOnce(appliedMigrations),
  } as unknown as Sequelize;
}

/** Redis is optional; `null` models a deployment without it configured. */
function createRedis(pingResult: 'ok' | 'fail'): OptionalRedisClient {
  return {
    ping:
      pingResult === 'ok'
        ? jest.fn().mockResolvedValue('PONG')
        : jest.fn().mockRejectedValue(new Error('connection refused')),
  } as unknown as OptionalRedisClient;
}

describe('HealthService', () => {
  it('reports process liveness without querying dependencies', () => {
    const sequelize = { query: jest.fn() } as unknown as Sequelize;
    const service = new HealthService(sequelize);

    const response = service.getLiveness();

    expect(response.status).toBe('ok');
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('reports readiness when PostgreSQL responds and every migration is applied', async () => {
    const service = new HealthService(createSequelize(allMigrationIds));

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      dependencies: { database: 'ready', migrations: 'up-to-date' },
    });
  });

  it('returns a controlled readiness failure without exposing database errors', async () => {
    const sequelize = {
      query: jest.fn().mockRejectedValue(new Error('sensitive database details')),
    } as unknown as Sequelize;
    const service = new HealthService(sequelize);

    await expect(service.getReadiness()).rejects.toThrow(ServiceUnavailableException);
  });

  it('refuses traffic when the schema is behind the deployed code', async () => {
    // The instance can reach PostgreSQL but the newest migration is missing:
    // serving traffic would fail on the first query touching the new objects.
    const service = new HealthService(createSequelize(allMigrationIds.slice(0, -1)));

    await expect(service.getReadiness()).rejects.toThrow(ServiceUnavailableException);
  });

  it('names the pending migrations so the failure is diagnosable', async () => {
    const missingMigrationId = allMigrationIds[allMigrationIds.length - 1].id;
    const service = new HealthService(createSequelize(allMigrationIds.slice(0, -1)));

    await expect(service.getReadiness()).rejects.toThrow(missingMigrationId);
  });

  it('refuses traffic when the migration registry is empty', async () => {
    const service = new HealthService(createSequelize([]));

    await expect(service.getReadiness()).rejects.toThrow(ServiceUnavailableException);
  });

  it('reports Redis as not configured when the client is absent', async () => {
    const service = new HealthService(createSequelize(allMigrationIds), null);

    await expect(service.getReadiness()).resolves.toMatchObject({
      dependencies: { redis: 'not-configured' },
    });
  });

  it('reports Redis as ready when it answers PING', async () => {
    const service = new HealthService(createSequelize(allMigrationIds), createRedis('ok'));

    await expect(service.getReadiness()).resolves.toMatchObject({
      dependencies: { redis: 'ready' },
    });
  });

  it('refuses traffic when a configured Redis is unreachable', async () => {
    // Degrading silently would leave rate limits per-process while the operator
    // believes they are shared, so this must remove the instance from rotation.
    const service = new HealthService(createSequelize(allMigrationIds), createRedis('fail'));

    await expect(service.getReadiness()).rejects.toThrow(ServiceUnavailableException);
  });

  it('stays ready when the database holds migrations this build does not know', async () => {
    // Rolling deploy: a newer instance has already migrated. The older instance
    // must not remove itself from rotation over migrations it does not ship.
    const service = new HealthService(
      createSequelize([...allMigrationIds, { id: '209901010001-future-migration' }]),
    );

    await expect(service.getReadiness()).resolves.toMatchObject({
      dependencies: { migrations: 'up-to-date' },
    });
  });
});
