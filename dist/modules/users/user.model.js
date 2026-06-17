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
exports.UserModel = void 0;
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
const anthropometric_profile_model_1 = require("../profiles/anthropometric-profile.model");
let UserModel = class UserModel extends sequelize_typescript_1.Model {
};
exports.UserModel = UserModel;
__decorate([
    sequelize_typescript_1.PrimaryKey,
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.UUIDV4),
    (0, sequelize_typescript_1.Column)(sequelize_typescript_1.DataType.UUID),
    __metadata("design:type", String)
], UserModel.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.STRING(180), allowNull: false, unique: true }),
    __metadata("design:type", String)
], UserModel.prototype, "email", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.STRING(255), allowNull: false, field: 'password_hash' }),
    __metadata("design:type", String)
], UserModel.prototype, "passwordHash", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.STRING(180), allowNull: false, field: 'nombre_completo' }),
    __metadata("design:type", String)
], UserModel.prototype, "nombreCompleto", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(domain_enums_1.UserRole.CLIENTE),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.UserRole)), allowNull: false }),
    __metadata("design:type", String)
], UserModel.prototype, "rol", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(domain_enums_1.UserStatus.ACTIVO),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.ENUM(...Object.values(domain_enums_1.UserStatus)), allowNull: false }),
    __metadata("design:type", String)
], UserModel.prototype, "estado", void 0);
__decorate([
    (0, sequelize_typescript_1.Default)(sequelize_typescript_1.DataType.NOW),
    (0, sequelize_typescript_1.Column)({ type: sequelize_typescript_1.DataType.DATE, allowNull: false, field: 'fecha_registro' }),
    __metadata("design:type", Date)
], UserModel.prototype, "fechaRegistro", void 0);
__decorate([
    (0, sequelize_typescript_1.HasOne)(() => anthropometric_profile_model_1.AnthropometricProfileModel),
    __metadata("design:type", anthropometric_profile_model_1.AnthropometricProfileModel)
], UserModel.prototype, "perfilAntropometrico", void 0);
__decorate([
    sequelize_typescript_1.CreatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'created_at' }),
    __metadata("design:type", Date)
], UserModel.prototype, "createdAt", void 0);
__decorate([
    sequelize_typescript_1.UpdatedAt,
    (0, sequelize_typescript_1.Column)({ field: 'updated_at' }),
    __metadata("design:type", Date)
], UserModel.prototype, "updatedAt", void 0);
exports.UserModel = UserModel = __decorate([
    (0, sequelize_typescript_1.Table)({ tableName: 'usuarios', underscored: true, timestamps: true })
], UserModel);
//# sourceMappingURL=user.model.js.map