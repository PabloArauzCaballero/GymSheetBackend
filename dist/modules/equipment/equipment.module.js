"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquipmentModule = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const equipment_controller_1 = require("./equipment.controller");
const equipment_model_1 = require("./equipment.model");
const equipment_repository_1 = require("./equipment.repository");
const equipment_service_1 = require("./equipment.service");
let EquipmentModule = class EquipmentModule {
};
exports.EquipmentModule = EquipmentModule;
exports.EquipmentModule = EquipmentModule = __decorate([
    (0, common_1.Module)({
        imports: [sequelize_1.SequelizeModule.forFeature([equipment_model_1.EquipmentModel])],
        controllers: [equipment_controller_1.EquipmentController, equipment_controller_1.AdminEquipmentController],
        providers: [equipment_repository_1.EquipmentRepository, equipment_service_1.EquipmentService],
        exports: [equipment_repository_1.EquipmentRepository, equipment_service_1.EquipmentService],
    })
], EquipmentModule);
//# sourceMappingURL=equipment.module.js.map