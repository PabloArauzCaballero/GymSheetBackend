import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MembershipModule } from '../membership/membership.module';
import { AccessCredentialModel } from './access-credential.model';
import { AdminAccessController, AccessHistoryController } from './access-control.controller';
import { AccessControlRepository } from './access-control.repository';
import { AccessControlService } from './access-control.service';
import { AccessDecisionModel } from './access-decision.model';
import { AccessDeviceEventModel } from './access-device-event.model';
import { AccessDeviceModel } from './access-device.model';

@Module({
  imports: [
    MembershipModule,
    SequelizeModule.forFeature([
      AccessCredentialModel,
      AccessDeviceModel,
      AccessDeviceEventModel,
      AccessDecisionModel,
    ]),
  ],
  controllers: [AccessHistoryController, AdminAccessController],
  providers: [AccessControlRepository, AccessControlService],
  exports: [AccessControlRepository, AccessControlService],
})
export class AccessControlModule {}
