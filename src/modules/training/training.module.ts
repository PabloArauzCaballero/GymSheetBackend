import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ExerciseModel } from '../exercises/exercise.model';
import { ExercisesModule } from '../exercises/exercises.module';
import { UserModel } from '../users/user.model';
import { WorkoutsModule } from '../workouts/workouts.module';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';
import { TrainingController } from './training.controller';
import { TrainingRepository } from './training.repository';
import { TrainingService } from './training.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      RoutineModel,
      RoutineExerciseModel,
      RoutineAssignmentModel,
      ExerciseModel,
      UserModel,
    ]),
    ExercisesModule,
    WorkoutsModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingRepository, TrainingService],
  exports: [TrainingService, TrainingRepository],
})
export class TrainingModule {}
