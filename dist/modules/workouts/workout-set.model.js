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
exports.WorkoutSetModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const workout_session_exercise_model_1 = require("./workout-session-exercise.model");
let WorkoutSetModel = class WorkoutSetModel extends sequelize_typescript_1.Model {
};
exports.WorkoutSetModel = WorkoutSetModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], WorkoutSetModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => workout_session_exercise_model_1.WorkoutSessionExerciseModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'sesion_ejercicio_id' }),
    __metadata("design:type", String)
], WorkoutSetModel.prototype, "sesionEjercicioId", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false, field: 'numero_serie' }),
    __metadata("design:type", Number)
], WorkoutSetModel.prototype, "numeroSerie", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false }),
    __metadata("design:type", Number)
], WorkoutSetModel.prototype, "repeticiones", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DECIMAL(7, 2), allowNull: false, field: 'peso_kg' }),
    __metadata("design:type", String)
], WorkoutSetModel.prototype, "pesoKg", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false }),
    __metadata("design:type", Number)
], WorkoutSetModel.prototype, "rir", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false, field: 'descanso_seg_anterior' }),
    __metadata("design:type", Number)
], WorkoutSetModel.prototype, "descansoSegAnterior", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.NOW),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DATE, allowNull: false, field: 'fecha_registro' }),
    __metadata("design:type", Date)
], WorkoutSetModel.prototype, "fechaRegistro", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => workout_session_exercise_model_1.WorkoutSessionExerciseModel),
    __metadata("design:type", workout_session_exercise_model_1.WorkoutSessionExerciseModel)
], WorkoutSetModel.prototype, "sesionEjercicio", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], WorkoutSetModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], WorkoutSetModel.prototype, "updatedAt", void 0);
exports.WorkoutSetModel = WorkoutSetModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'series_entrenamiento', underscored: true, timestamps: true })
], WorkoutSetModel);
//# sourceMappingURL=workout-set.model.js.map