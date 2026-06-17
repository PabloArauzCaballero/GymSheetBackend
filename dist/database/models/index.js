"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseModels = void 0;
const user_model_1 = require("../../modules/users/user.model");
const anthropometric_profile_model_1 = require("../../modules/profiles/anthropometric-profile.model");
const equipment_model_1 = require("../../modules/equipment/equipment.model");
const exercise_model_1 = require("../../modules/exercises/exercise.model");
const exercise_equipment_model_1 = require("../../modules/exercises/exercise-equipment.model");
const user_exercise_model_1 = require("../../modules/exercises/user-exercise.model");
const workout_session_model_1 = require("../../modules/workouts/workout-session.model");
const workout_session_exercise_model_1 = require("../../modules/workouts/workout-session-exercise.model");
const workout_set_model_1 = require("../../modules/workouts/workout-set.model");
exports.databaseModels = [
    user_model_1.UserModel,
    anthropometric_profile_model_1.AnthropometricProfileModel,
    equipment_model_1.EquipmentModel,
    exercise_model_1.ExerciseModel,
    exercise_equipment_model_1.ExerciseEquipmentModel,
    user_exercise_model_1.UserExerciseModel,
    workout_session_model_1.WorkoutSessionModel,
    workout_session_exercise_model_1.WorkoutSessionExerciseModel,
    workout_set_model_1.WorkoutSetModel,
];
//# sourceMappingURL=index.js.map