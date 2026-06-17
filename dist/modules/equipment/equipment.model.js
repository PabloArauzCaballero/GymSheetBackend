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
exports.EquipmentModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
let EquipmentModel = class EquipmentModel extends sequelize_typescript_1.Model {
};
exports.EquipmentModel = EquipmentModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], EquipmentModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.STRING(140), allowNull: false }),
    __metadata("design:type", String)
], EquipmentModel.prototype, "nombre", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.EquipmentType)), allowNull: false }),
    __metadata("design:type", String)
], EquipmentModel.prototype, "tipo", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.TEXT, allowNull: true }),
    __metadata("design:type", Object)
], EquipmentModel.prototype, "descripcion", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(domain_enums_1.EquipmentStatus.DISPONIBLE),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.EquipmentStatus)), allowNull: false }),
    __metadata("design:type", String)
], EquipmentModel.prototype, "estado", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], EquipmentModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], EquipmentModel.prototype, "updatedAt", void 0);
exports.EquipmentModel = EquipmentModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'equipos_gym', underscored: true, timestamps: true })
], EquipmentModel);
//# sourceMappingURL=equipment.model.js.map