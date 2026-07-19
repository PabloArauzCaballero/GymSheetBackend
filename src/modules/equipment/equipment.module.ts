import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AdminEquipmentController, EquipmentController } from './equipment.controller';
import { EquipmentModel } from './equipment.model';
import { EquipmentRepository } from './equipment.repository';
import { EquipmentService } from './equipment.service';

@Module({
  imports: [SequelizeModule.forFeature([EquipmentModel])],
  controllers: [EquipmentController, AdminEquipmentController],
  providers: [EquipmentRepository, EquipmentService],
  exports: [EquipmentRepository, EquipmentService, SequelizeModule],
})
export class EquipmentModule {}
