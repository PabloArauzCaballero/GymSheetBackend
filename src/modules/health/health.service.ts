import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

export type LivenessResponse = {
  status: 'ok';
  timestamp: string;
};

export type ReadinessResponse = LivenessResponse & {
  dependencies: {
    database: 'ready';
  };
};

@Injectable()
export class HealthService {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Reports whether the Node.js process can serve HTTP requests.
   * It intentionally avoids external dependencies so orchestrators do not
   * restart a healthy process during a temporary database outage.
   */
  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verifies that the application can reach PostgreSQL before receiving traffic.
   * The global database statement timeout bounds this probe.
   */
  async getReadiness(): Promise<ReadinessResponse> {
    try {
      await this.sequelize.query('SELECT 1 AS ready', {
        type: QueryTypes.SELECT,
        raw: true,
      });
    } catch {
      throw new ServiceUnavailableException('Application dependencies are not ready.');
    }

    return {
      ...this.getLiveness(),
      dependencies: {
        database: 'ready',
      },
    };
  }
}
