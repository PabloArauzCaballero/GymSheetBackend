import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccessControlModule } from '../modules/access-control/access-control.module';
import { AccessEventRunner } from './access-event.runner';

@Module({
  imports: [DatabaseModule, AccessControlModule],
  providers: [AccessEventRunner],
})
export class AccessWorkerModule {}
