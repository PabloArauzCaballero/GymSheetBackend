import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AntibotPersistenceModule } from '../modules/antibot/antibot-persistence.module';

/** Minimal context for the signup retention command: database and the anti-bot tables only. */
@Module({
  imports: [DatabaseModule, AntibotPersistenceModule],
})
export class SignupMaintenanceModule {}
