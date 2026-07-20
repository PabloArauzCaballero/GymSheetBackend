import { Sequelize } from 'sequelize-typescript';
import { HttpMetricsService } from './http-metrics.service';

describe('HttpMetricsService', () => {
  it('renders HTTP, memory, and pool metrics without request payloads', () => {
    const sequelize = {
      connectionManager: {
        pool: {
          size: 3,
          available: 1,
          using: 2,
          waiting: 0,
        },
      },
    } as unknown as Sequelize;
    const service = new HttpMetricsService(sequelize);

    service.recordHttpRequest('get', '/api/v1/exercises', 200, 125);
    const output = service.renderPrometheus();

    expect(output).toContain('gym_sheet_process_resident_memory_bytes');
    expect(output).toContain('gym_sheet_database_pool_connections{state="using"} 2');
    expect(output).toContain(
      'gym_sheet_http_requests_total{method="GET",route="/api/v1/exercises",status="200"} 1',
    );
    expect(output).not.toContain('Authorization');
  });

  it('drops new cardinality after the bounded series limit', () => {
    const sequelize = { connectionManager: { pool: {} } } as unknown as Sequelize;
    const service = new HttpMetricsService(sequelize);

    for (let index = 0; index < 260; index += 1) {
      service.recordHttpRequest('GET', `/route-${index}`, 200, 1);
    }

    expect(service.renderPrometheus()).toContain(
      'gym_sheet_http_metric_series_dropped_total 10',
    );
  });
});
