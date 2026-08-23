import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EquipmentModule } from '../equipment/equipment.module';
import {
  ExerciseMediaController,
  ExerciseMediaManagementController,
} from './exercise-media.controller';
import { ExerciseMediaModel } from './exercise-media.model';
import { ExerciseMediaRepository } from './exercise-media.repository';
import { ExerciseMediaService } from './exercise-media.service';
import { EquipmentInferenceService } from './equipment-inference.service';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseModel } from './exercise.model';
import {
  AdminExercisesController,
  ExercisesController,
  UserExercisesController,
} from './exercises.controller';
import { ExercisesRepository } from './exercises.repository';
import { ExercisesService } from './exercises.service';
import { ExercisesDatasetClient } from './import/exercises-dataset.client';
import { ExercisesDatasetController } from './import/exercises-dataset.controller';
import { ExercisesDatasetRepository } from './import/exercises-dataset.repository';
import { ExercisesDatasetService } from './import/exercises-dataset.service';
import { UserExerciseModel } from './user-exercise.model';
import { ExerciseMuscleModel } from './muscles/exercise-muscle.model';
import { ExerciseRatingModel } from './muscles/exercise-rating.model';
import { MuscleGroupModel } from './muscles/muscle-group.model';
import { MuscleModel } from './muscles/muscle.model';
import { UserExercisePreferenceModel } from './muscles/user-exercise-preference.model';
import { MusclesService } from './muscles/muscles.service';
import {
  ExerciseMusclesController,
  ExercisePreferencesController,
  MuscleGroupsController,
  MusclesCatalogController,
} from './muscles/muscles.controller';

@Module({
  imports: [
    EquipmentModule,
    SequelizeModule.forFeature([
      ExerciseModel,
      ExerciseEquipmentModel,
      UserExerciseModel,
      ExerciseMediaModel,
      MuscleGroupModel,
      MuscleModel,
      ExerciseMuscleModel,
      ExerciseRatingModel,
      UserExercisePreferenceModel,
    ]),
  ],
  controllers: [
    ExercisesController,
    AdminExercisesController,
    UserExercisesController,
    ExerciseMediaController,
    ExerciseMediaManagementController,
    ExercisesDatasetController,
    MuscleGroupsController,
    MusclesCatalogController,
    ExerciseMusclesController,
    ExercisePreferencesController,
  ],
  providers: [
    ExercisesRepository,
    ExercisesService,
    EquipmentInferenceService,
    ExerciseMediaRepository,
    ExerciseMediaService,
    ExercisesDatasetClient,
    ExercisesDatasetRepository,
    ExercisesDatasetService,
    MusclesService,
  ],
  exports: [
    ExercisesService,
    ExercisesRepository,
    ExerciseMediaRepository,
    ExercisesDatasetService,
  ],
})
export class ExercisesModule {}
