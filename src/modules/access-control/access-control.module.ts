import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { env } from '../../config/env';
import { MembershipModule } from '../membership/membership.module';
import { AccessCredentialModule } from './access-credential.module';
import {
  AdminAccessController,
  AccessHistoryController,
} from './access-control.controller';
import { AccessControlRepository } from './access-control.repository';
import { AccessControlService } from './access-control.service';
import { AccessDecisionModel } from './access-decision.model';
import { AccessDeviceEventModel } from './access-device-event.model';
import { AccessDeviceModel } from './access-device.model';
import { MockAccessController } from './mock-access.controller';

@Module({
  imports: [
    MembershipModule,
    AccessCredentialModule,
    SequelizeModule.forFeature([
      AccessDeviceModel,
      AccessDeviceEventModel,
      AccessDecisionModel,
    ]),
  ],
  controllers: [
    AccessHistoryController,
    AdminAccessController,
    ...(env.ACCESS_MOCK_ENABLED ? [MockAccessController] : []),
  ],
  providers: [AccessControlRepository, AccessControlService],
  exports: [AccessControlRepository, AccessControlService],
})
export class AccessControlModule {}
