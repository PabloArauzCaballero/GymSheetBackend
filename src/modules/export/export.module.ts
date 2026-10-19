import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProductEvents } from '../../common/tracking/product-events';
import { EquipmentModule } from '../equipment/equipment.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { RoutineModel } from '../training/routine.model';
import { RoutineDayModel } from '../training/routine-day.model';
import { RoutineExerciseModel } from '../training/routine-exercise.model';
import { ExerciseModel } from '../exercises/exercise.model';
import { TrainingProgramModel, ProgramLiftTargetModel } from '../programs/program.models';
import { WorkoutSessionModel } from '../workouts/workout-session.model';
import { WorkoutSessionExerciseModel } from '../workouts/workout-session-exercise.model';
import { WorkoutSetModel } from '../workouts/workout-set.model';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { RoutineProgressDownloadAuditModel } from './routine-progress-download-audit.model';

@Module({
  imports: [
    UsersModule,
    ProfilesModule,
    WorkoutsModule,
    EquipmentModule,
    SequelizeModule.forFeature([
      RoutineProgressDownloadAuditModel,
      RoutineModel,
      RoutineDayModel,
      RoutineExerciseModel,
      ExerciseModel,
      TrainingProgramModel,
      ProgramLiftTargetModel,
      WorkoutSessionModel,
      WorkoutSessionExerciseModel,
      WorkoutSetModel,
    ]),
  ],
  controllers: [ExportController],
  providers: [ExportService, ProductEvents],
  exports: [ExportService],
})
export class ExportModule {}
