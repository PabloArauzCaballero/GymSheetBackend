import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ExercisesModule } from '../exercises/exercises.module';
import { ExerciseModel } from '../exercises/exercise.model';
import { FacilitiesModule } from '../facilities/facilities.module';
import { ProgressionModule } from '../progression/progression.module';
import { FreeWorkoutController } from './free-workout.controller';
import { FreeWorkoutService } from './free-workout.service';
import { SessionEditsRepository } from './session-edits.repository';
import { WorkoutCatalogRepository } from './workout-catalog.repository';
import { WorkoutExerciseSwapModel } from './workout-exercise-swap.model';
import { WorkoutsController } from './workouts.controller';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutSkippedSetModel } from './workout-skipped-set.model';
import { SessionHooksRegistry } from './session-hooks';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [
    SequelizeModule.forFeature([WorkoutSessionModel, WorkoutSessionExerciseModel, WorkoutSetModel, WorkoutSkippedSetModel, WorkoutExerciseSwapModel, ExerciseModel]),
    ExercisesModule,
    FacilitiesModule,
    ProgressionModule,
  ],
  controllers: [WorkoutsController, FreeWorkoutController],
  providers: [
    WorkoutsRepository,
    WorkoutsService,
    SessionHooksRegistry,
    WorkoutCatalogRepository,
    SessionEditsRepository,
    FreeWorkoutService,
  ],
  exports: [WorkoutsService, WorkoutsRepository, SessionHooksRegistry, FreeWorkoutService],
})
export class WorkoutsModule {}
