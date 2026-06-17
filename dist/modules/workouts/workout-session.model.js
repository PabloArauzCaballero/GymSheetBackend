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
exports.WorkoutSessionModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
const user_model_1 = require("../users/user.model");
const workout_session_exercise_model_1 = require("./workout-session-exercise.model");
let WorkoutSessionModel = class WorkoutSessionModel extends sequelize_typescript_1.Model {
};
exports.WorkoutSessionModel = WorkoutSessionModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], WorkoutSessionModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => user_model_1.UserModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'usuario_id' }),
    __metadata("design:type", String)
], WorkoutSessionModel.prototype, "usuarioId", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.NOW),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DATE, allowNull: false, field: 'fecha_inicio' }),
    __metadata("design:type", Date)
], WorkoutSessionModel.prototype, "fechaInicio", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DATE, allowNull: true, field: 'fecha_fin' }),
    __metadata("design:type", Object)
], WorkoutSessionModel.prototype, "fechaFin", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(domain_enums_1.WorkoutSessionStatus.EN_PROGRESO),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.WorkoutSessionStatus)), allowNull: false }),
    __metadata("design:type", String)
], WorkoutSessionModel.prototype, "estado", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.TEXT, allowNull: true }),
    __metadata("design:type", Object)
], WorkoutSessionModel.prototype, "observacion", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => user_model_1.UserModel),
    __metadata("design:type", user_model_1.UserModel)
], WorkoutSessionModel.prototype, "usuario", void 0);
__decorate([
    (0, sequelize_typescript_1.HasMany)(() => workout_session_exercise_model_1.WorkoutSessionExerciseModel),
    __metadata("design:type", Array)
], WorkoutSessionModel.prototype, "ejercicios", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], WorkoutSessionModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], WorkoutSessionModel.prototype, "updatedAt", void 0);
exports.WorkoutSessionModel = WorkoutSessionModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'sesiones_entrenamiento', underscored: true, timestamps: true })
], WorkoutSessionModel);
//# sourceMappingURL=workout-session.model.js.map