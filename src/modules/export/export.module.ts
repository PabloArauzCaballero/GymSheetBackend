import { Module } from '@nestjs/common';
import { EquipmentModule } from '../equipment/equipment.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [UsersModule, ProfilesModule, WorkoutsModule, EquipmentModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
