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
exports.ExerciseEquipmentModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const equipment_model_1 = require("../equipment/equipment.model");
const exercise_model_1 = require("./exercise.model");
let ExerciseEquipmentModel = class ExerciseEquipmentModel extends sequelize_typescript_1.Model {
};
exports.ExerciseEquipmentModel = ExerciseEquipmentModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], ExerciseEquipmentModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => exercise_model_1.ExerciseModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'ejercicio_id' }),
    __metadata("design:type", String)
], ExerciseEquipmentModel.prototype, "ejercicioId", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => equipment_model_1.EquipmentModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, field: 'equipo_gym_id' }),
    __metadata("design:type", String)
], ExerciseEquipmentModel.prototype, "equipoGymId", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => exercise_model_1.ExerciseModel),
    __metadata("design:type", exercise_model_1.ExerciseModel)
], ExerciseEquipmentModel.prototype, "ejercicio", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => equipment_model_1.EquipmentModel),
    __metadata("design:type", equipment_model_1.EquipmentModel)
], ExerciseEquipmentModel.prototype, "equipo", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], ExerciseEquipmentModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], ExerciseEquipmentModel.prototype, "updatedAt", void 0);
exports.ExerciseEquipmentModel = ExerciseEquipmentModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'ejercicios_equipos', underscored: true, timestamps: true })
], ExerciseEquipmentModel);
//# sourceMappingURL=exercise-equipment.model.js.map