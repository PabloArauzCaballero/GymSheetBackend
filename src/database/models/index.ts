import { EquipmentModel } from '../../modules/equipment/equipment.model';
import { ExerciseEquipmentModel } from '../../modules/exercises/exercise-equipment.model';
import { ExerciseMediaModel } from '../../modules/exercises/exercise-media.model';
import { ExerciseModel } from '../../modules/exercises/exercise.model';
import { UserExerciseModel } from '../../modules/exercises/user-exercise.model';
import { AnthropometricProfileModel } from '../../modules/profiles/anthropometric-profile.model';
import { UserModel } from '../../modules/users/user.model';
import { WorkoutSessionExerciseModel } from '../../modules/workouts/workout-session-exercise.model';
import { WorkoutSessionModel } from '../../modules/workouts/workout-session.model';
import { WorkoutSetModel } from '../../modules/workouts/workout-set.model';

/**
 * Explicit model registry used by Sequelize. Keeping this list deterministic
 * prevents accidental runtime discovery of undeclared persistence models.
 */
export const databaseModels = [
  UserModel,
  AnthropometricProfileModel,
  EquipmentModel,
  ExerciseModel,
  ExerciseEquipmentModel,
  ExerciseMediaModel,
  UserExerciseModel,
  WorkoutSessionModel,
  WorkoutSessionExerciseModel,
  WorkoutSetModel,
];
