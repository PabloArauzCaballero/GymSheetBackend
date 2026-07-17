import { ServiceUnavailableException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports process liveness without querying dependencies', () => {
    const sequelize = { query: jest.fn() } as unknown as Sequelize;
    const service = new HealthService(sequelize);

    const response = service.getLiveness();

    expect(response.status).toBe('ok');
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('reports readiness after PostgreSQL responds', async () => {
    const sequelize = {
      query: jest.fn().mockResolvedValue([{ ready: 1 }]),
    } as unknown as Sequelize;
    const service = new HealthService(sequelize);

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      dependencies: { database: 'ready' },
    });
  });

  it('returns a controlled readiness failure without exposing database errors', async () => {
    const sequelize = {
      query: jest.fn().mockRejectedValue(new Error('sensitive database details')),
    } as unknown as Sequelize;
    const service = new HealthService(sequelize);

    await expect(service.getReadiness()).rejects.toThrow(ServiceUnavailableException);
  });
});
