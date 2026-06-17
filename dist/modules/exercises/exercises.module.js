"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExercisesModule = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const equipment_model_1 = require("../equipment/equipment.model");
const exercises_controller_1 = require("./exercises.controller");
const exercise_equipment_model_1 = require("./exercise-equipment.model");
const exercise_model_1 = require("./exercise.model");
const exercises_repository_1 = require("./exercises.repository");
const exercises_service_1 = require("./exercises.service");
const user_exercise_model_1 = require("./user-exercise.model");
let ExercisesModule = class ExercisesModule {
};
exports.ExercisesModule = ExercisesModule;
exports.ExercisesModule = ExercisesModule = __decorate([
    (0, common_1.Module)({
        imports: [sequelize_1.SequelizeModule.forFeature([exercise_model_1.ExerciseModel, exercise_equipment_model_1.ExerciseEquipmentModel, user_exercise_model_1.UserExerciseModel, equipment_model_1.EquipmentModel])],
        controllers: [exercises_controller_1.ExercisesController, exercises_controller_1.AdminExercisesController, exercises_controller_1.UserExercisesController],
        providers: [exercises_repository_1.ExercisesRepository, exercises_service_1.ExercisesService],
        exports: [exercises_service_1.ExercisesService, exercises_repository_1.ExercisesRepository],
    })
], ExercisesModule);
//# sourceMappingURL=exercises.module.js.map