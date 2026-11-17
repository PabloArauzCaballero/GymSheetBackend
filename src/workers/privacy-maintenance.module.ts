import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PrivacyRetentionModule } from '../modules/privacy/privacy-retention.module';

/** Minimal context for the personal-data retention command: database and retention only. */
@Module({
  imports: [DatabaseModule, PrivacyRetentionModule],
})
export class PrivacyMaintenanceModule {}
