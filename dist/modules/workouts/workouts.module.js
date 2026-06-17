"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkoutsModule = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const exercises_module_1 = require("../exercises/exercises.module");
const exercise_model_1 = require("../exercises/exercise.model");
const workouts_controller_1 = require("./workouts.controller");
const workout_session_exercise_model_1 = require("./workout-session-exercise.model");
const workout_session_model_1 = require("./workout-session.model");
const workout_set_model_1 = require("./workout-set.model");
const workouts_repository_1 = require("./workouts.repository");
const workouts_service_1 = require("./workouts.service");
let WorkoutsModule = class WorkoutsModule {
};
exports.WorkoutsModule = WorkoutsModule;
exports.WorkoutsModule = WorkoutsModule = __decorate([
    (0, common_1.Module)({
        imports: [sequelize_1.SequelizeModule.forFeature([workout_session_model_1.WorkoutSessionModel, workout_session_exercise_model_1.WorkoutSessionExerciseModel, workout_set_model_1.WorkoutSetModel, exercise_model_1.ExerciseModel]), exercises_module_1.ExercisesModule],
        controllers: [workouts_controller_1.WorkoutsController],
        providers: [workouts_repository_1.WorkoutsRepository, workouts_service_1.WorkoutsService],
        exports: [workouts_service_1.WorkoutsService, workouts_repository_1.WorkoutsRepository],
    })
], WorkoutsModule);
//# sourceMappingURL=workouts.module.js.map