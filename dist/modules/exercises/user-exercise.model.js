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
exports.UserExerciseModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const user_model_1 = require("../users/user.model");
const exercise_model_1 = require("./exercise.model");
let UserExerciseModel = class UserExerciseModel extends sequelize_typescript_1.Model {
};
exports.UserExerciseModel = UserExerciseModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], UserExerciseModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => user_model_1.UserModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'usuario_id' }),
    __metadata("design:type", String)
], UserExerciseModel.prototype, "usuarioId", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => exercise_model_1.ExerciseModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'ejercicio_id' }),
    __metadata("design:type", String)
], UserExerciseModel.prototype, "ejercicioId", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.NOW),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DATE, allowNull: false, field: 'fecha_seleccion' }),
    __metadata("design:type", Date)
], UserExerciseModel.prototype, "fechaSeleccion", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => user_model_1.UserModel),
    __metadata("design:type", user_model_1.UserModel)
], UserExerciseModel.prototype, "usuario", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => exercise_model_1.ExerciseModel),
    __metadata("design:type", exercise_model_1.ExerciseModel)
], UserExerciseModel.prototype, "ejercicio", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], UserExerciseModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], UserExerciseModel.prototype, "updatedAt", void 0);
exports.UserExerciseModel = UserExerciseModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'usuarios_ejercicios', underscored: true, timestamps: true })
], UserExerciseModel);
//# sourceMappingURL=user-exercise.model.js.map