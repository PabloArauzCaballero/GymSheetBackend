import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ExerciseModel } from '../exercises/exercise.model';
import { ExercisesModule } from '../exercises/exercises.module';
import { UserModel } from '../users/user.model';
import { WorkoutsModule } from '../workouts/workouts.module';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineDayModel } from './routine-day.model';
import { RoutineShareModel } from './routine-share.model';
import { RoutineWeekOverrideModel } from './routine-week-override.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';
import { RoutineAccessService } from './routine-access.service';
import { RoutineDaysRepository } from './routine-days.repository';
import { RoutineStructureService } from './routine-structure.service';
import { TrainingController } from './training.controller';
import { TrainingRepository } from './training.repository';
import { TrainingService } from './training.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      RoutineModel,
      RoutineExerciseModel,
      RoutineAssignmentModel,
      RoutineDayModel,
      RoutineShareModel,
      RoutineWeekOverrideModel,
      ExerciseModel,
      UserModel,
    ]),
    ExercisesModule,
    WorkoutsModule,
  ],
  controllers: [TrainingController],
  providers: [
    TrainingRepository,
    TrainingService,
    RoutineDaysRepository,
    RoutineAccessService,
    RoutineStructureService,
  ],
  exports: [TrainingService, TrainingRepository, RoutineAccessService],
})
export class TrainingModule {}
