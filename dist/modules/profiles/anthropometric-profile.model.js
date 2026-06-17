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
exports.AnthropometricProfileModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
const user_model_1 = require("../users/user.model");
let AnthropometricProfileModel = class AnthropometricProfileModel extends sequelize_typescript_1.Model {
};
exports.AnthropometricProfileModel = AnthropometricProfileModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], AnthropometricProfileModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.ForeignKey)(() => user_model_1.UserModel),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.UUID, allowNull: false, unique: true, field: 'usuario_id' }),
    __metadata("design:type", String)
], AnthropometricProfileModel.prototype, "usuarioId", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false }),
    __metadata("design:type", Number)
], AnthropometricProfileModel.prototype, "edad", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DECIMAL(6, 2), allowNull: false, field: 'peso_kg' }),
    __metadata("design:type", String)
], AnthropometricProfileModel.prototype, "pesoKg", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.INTEGER, allowNull: false, field: 'estatura_cm' }),
    __metadata("design:type", Number)
], AnthropometricProfileModel.prototype, "estaturaCm", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.TrainingGoal)), allowNull: false }),
    __metadata("design:type", String)
], AnthropometricProfileModel.prototype, "objetivo", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.NOW),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DATE, allowNull: false, field: 'fecha_actualizacion' }),
    __metadata("design:type", Date)
], AnthropometricProfileModel.prototype, "fechaActualizacion", void 0);
__decorate([
    (0, sequelize_typescript_1.BelongsTo)(() => user_model_1.UserModel),
    __metadata("design:type", user_model_1.UserModel)
], AnthropometricProfileModel.prototype, "usuario", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], AnthropometricProfileModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], AnthropometricProfileModel.prototype, "updatedAt", void 0);
exports.AnthropometricProfileModel = AnthropometricProfileModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'perfiles_antropometricos', underscored: true, timestamps: true })
], AnthropometricProfileModel);
//# sourceMappingURL=anthropometric-profile.model.js.map