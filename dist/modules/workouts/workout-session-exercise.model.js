"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkoutSessionExerciseModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const exercise_model_1 = require("../exercises/exercise.model");
const workout_session_model_1 = require("./workout-session.model");
const workout_set_model_1 = require("./workout-set.model");
let WorkoutSessionExerciseModel = class WorkoutSessionExerciseModel extends sequelize_typescript_1.Model {
};
exports.WorkoutSessionExerciseModel = WorkoutSessionExerciseModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], WorkoutSessionExerciseModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => workout_session_model_1.WorkoutSessionModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'sesion_id' }),
    __metadata("design:type", String)
], WorkoutSessionExerciseModel.prototype, "sesionId", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => exercise_model_1.ExerciseModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'ejercicio_id' }),
    __metadata("design:type", String)
], WorkoutSessionExerciseModel.prototype, "ejercicioId", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false }),
    __metadata("design:type", Number)
], WorkoutSessionExerciseModel.prototype, "orden", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(false),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.BOOLEAN, allowNull: false, field: 'es_enfasis' }),
    __metadata("design:type", Boolean)
], WorkoutSessionExerciseModel.prototype, "esEnfasis", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.TEXT, allowNull: true }),
    __metadata("design:type", Object)
], WorkoutSessionExerciseModel.prototype, "nota", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => workout_session_model_1.WorkoutSessionModel),
    __metadata("design:type", workout_session_model_1.WorkoutSessionModel)
], WorkoutSessionExerciseModel.prototype, "sesion", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => exercise_model_1.ExerciseModel),
    __metadata("design:type", exercise_model_1.ExerciseModel)
], WorkoutSessionExerciseModel.prototype, "ejercicio", void 0);
__decorate([
    (0, sequelize_typescript_1.HasMany)(() => workout_set_model_1.WorkoutSetModel),
    __metadata("design:type", Array)
], WorkoutSessionExerciseModel.prototype, "series", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], WorkoutSessionExerciseModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], WorkoutSessionExerciseModel.prototype, "updatedAt", void 0);
exports.WorkoutSessionExerciseModel = WorkoutSessionExerciseModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'sesiones_ejercicios', underscored: true, timestamps: true })
], WorkoutSessionExerciseModel);
//# sourceMappingURL=workout-session-exercise.model.js.map