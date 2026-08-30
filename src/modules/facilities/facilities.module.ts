import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EquipmentModule } from '../equipment/equipment.module';
import { IntegrationModule } from '../integration/integration.module';
import { AccessPointModel } from './access-point.model';
import { BranchModel } from './branch.model';
import { EquipmentAssignmentModel } from './equipment-assignment.model';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesRepository } from './facilities.repository';
import { FacilitiesService } from './facilities.service';
import { MaintenanceEventModel } from './maintenance-event.model';
import { PublicFacilitiesController } from './public-facilities.controller';
import { PublicFacilitiesRepository } from './public-facilities.repository';
import { PublicFacilitiesService } from './public-facilities.service';
import { RoomModel } from './room.model';

@Module({
  imports: [
    EquipmentModule,
    IntegrationModule,
    SequelizeModule.forFeature([
      BranchModel,
      RoomModel,
      AccessPointModel,
      EquipmentAssignmentModel,
      MaintenanceEventModel,
    ]),
  ],
  controllers: [FacilitiesController, PublicFacilitiesController],
  providers: [
    FacilitiesRepository,
    FacilitiesService,
    PublicFacilitiesRepository,
    PublicFacilitiesService,
  ],
  exports: [FacilitiesRepository, FacilitiesService],
})
export class FacilitiesModule {}
