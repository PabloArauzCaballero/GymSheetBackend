import { UserModel } from '../../modules/users/user.model';
import { AnthropometricProfileModel } from '../../modules/profiles/anthropometric-profile.model';
import { EquipmentModel } from '../../modules/equipment/equipment.model';
import { ExerciseModel } from '../../modules/exercises/exercise.model';
import { ExerciseEquipmentModel } from '../../modules/exercises/exercise-equipment.model';
import { UserExerciseModel } from '../../modules/exercises/user-exercise.model';
import { WorkoutSessionModel } from '../../modules/workouts/workout-session.model';
import { WorkoutSessionExerciseModel } from '../../modules/workouts/workout-session-exercise.model';
import { WorkoutSetModel } from '../../modules/workouts/workout-set.model';

export const databaseModels = [
  UserModel,
  AnthropometricProfileModel,
  EquipmentModel,
  ExerciseModel,
  ExerciseEquipmentModel,
  UserExerciseModel,
  WorkoutSessionModel,
  WorkoutSessionExerciseModel,
  WorkoutSetModel,
];
