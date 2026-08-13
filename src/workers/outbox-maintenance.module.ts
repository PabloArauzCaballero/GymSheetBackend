import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IntegrationModule } from '../modules/integration/integration.module';

/**
 * Minimal context for the outbox retention command: the database connection and
 * the integration providers, with no HTTP surface or workers attached.
 */
@Module({
  imports: [DatabaseModule, IntegrationModule],
})
export class OutboxMaintenanceModule {}
