import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ExercisesModule } from '../exercises/exercises.module';
import { ExerciseModel } from '../exercises/exercise.model';
import { FacilitiesModule } from '../facilities/facilities.module';
import { ProgressionModule } from '../progression/progression.module';
import { WorkoutsController } from './workouts.controller';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { SessionHooksRegistry } from './session-hooks';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [
    SequelizeModule.forFeature([WorkoutSessionModel, WorkoutSessionExerciseModel, WorkoutSetModel, ExerciseModel]),
    ExercisesModule,
    FacilitiesModule,
    ProgressionModule,
  ],
  controllers: [WorkoutsController],
  providers: [WorkoutsRepository, WorkoutsService, SessionHooksRegistry],
  exports: [WorkoutsService, WorkoutsRepository, SessionHooksRegistry],
})
export class WorkoutsModule {}
