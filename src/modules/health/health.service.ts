import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { databaseMigrations } from '../../database/migrations';

export type LivenessResponse = {
  status: 'ok';
  timestamp: string;
};

export type ReadinessResponse = LivenessResponse & {
  dependencies: {
    database: 'ready';
    migrations: 'up-to-date';
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
    let appliedMigrationIds: string[];

    try {
      await this.sequelize.query('SELECT 1 AS ready', {
        type: QueryTypes.SELECT,
        raw: true,
      });
      appliedMigrationIds = await this.readAppliedMigrationIds();
    } catch {
      throw new ServiceUnavailableException('Application dependencies are not ready.');
    }

    const pendingMigrationIds = this.findPendingMigrationIds(appliedMigrationIds);

    if (pendingMigrationIds.length > 0) {
      // A reachable database is not sufficient: an instance whose schema predates
      // the code it runs would accept traffic and fail on the first query that
      // touches a new column. Identifiers are internal migration names, not
      // sensitive data, so naming them keeps the failure diagnosable.
      throw new ServiceUnavailableException(
        `Pending database migrations: ${pendingMigrationIds.join(', ')}.`,
      );
    }

    return {
      ...this.getLiveness(),
      dependencies: {
        database: 'ready',
        migrations: 'up-to-date',
      },
    };
  }

  private async readAppliedMigrationIds(): Promise<string[]> {
    const rows = await this.sequelize.query<{ id: string }>(
      'SELECT id FROM app_meta.schema_migrations',
      { type: QueryTypes.SELECT, raw: true },
    );
    return rows.map((row) => row.id);
  }

  /**
   * Reports migrations bundled with this build that the database has not applied.
   * Rows present in the database but absent from the build are ignored on
   * purpose: during a rolling deploy an older instance briefly sees migrations
   * applied by a newer one, and that must not take the older instance out of
   * rotation.
   */
  private findPendingMigrationIds(appliedMigrationIds: string[]): string[] {
    const applied = new Set(appliedMigrationIds);
    return databaseMigrations
      .map((migration) => migration.id)
      .filter((migrationId) => !applied.has(migrationId));
  }
}
