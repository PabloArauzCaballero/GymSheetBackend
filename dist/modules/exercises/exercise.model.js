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
exports.ExerciseModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
const user_model_1 = require("../users/user.model");
const exercise_equipment_model_1 = require("./exercise-equipment.model");
let ExerciseModel = class ExerciseModel extends sequelize_typescript_1.Model {
};
exports.ExerciseModel = ExerciseModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], ExerciseModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.STRING(160), allowNull: false }),
    __metadata("design:type", String)
], ExerciseModel.prototype, "nombre", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.STRING(100), allowNull: false, field: 'grupo_muscular' }),
    __metadata("design:type", String)
], ExerciseModel.prototype, "grupoMuscular", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.TEXT, allowNull: true }),
    __metadata("design:type", Object)
], ExerciseModel.prototype, "descripcion", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.ExerciseType)), allowNull: false, field: 'tipo_ejercicio' }),
    __metadata("design:type", String)
], ExerciseModel.prototype, "tipoEjercicio", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => user_model_1.UserModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: true, field: 'created_by_usuario_id' }),
    __metadata("design:type", Object)
], ExerciseModel.prototype, "createdByUsuarioId", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(domain_enums_1.ExerciseStatus.ACTIVO),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.ExerciseStatus)), allowNull: false }),
    __metadata("design:type", String)
], ExerciseModel.prototype, "estado", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => user_model_1.UserModel),
    __metadata("design:type", user_model_1.UserModel)
], ExerciseModel.prototype, "createdByUsuario", void 0);
__decorate([
    (0, sequelize_typescript_1.HasMany)(() => exercise_equipment_model_1.ExerciseEquipmentModel),
    __metadata("design:type", Array)
], ExerciseModel.prototype, "equipos", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], ExerciseModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], ExerciseModel.prototype, "updatedAt", void 0);
exports.ExerciseModel = ExerciseModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'ejercicios', underscored: true, timestamps: true })
], ExerciseModel);
//# sourceMappingURL=exercise.model.js.map