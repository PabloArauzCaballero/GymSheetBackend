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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquipmentRepository = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const domain_enums_1 = require("../../common/enums/domain.enums");
const equipment_model_1 = require("./equipment.model");
let EquipmentRepository = class EquipmentRepository {
    constructor(equipmentModel) {
        this.equipmentModel = equipmentModel;
    }
    findAvailable() {
        return this.equipmentModel.findAll({
            where: { estado: domain_enums_1.EquipmentStatus.DISPONIBLE },
            order: [['tipo', 'ASC'], ['nombre', 'ASC']],
        });
    }
    findById(id) {
        return this.equipmentModel.findByPk(id);
    }
    create(input) {
        return this.equipmentModel.create(input);
    }
    async update(id, input) {
        const equipment = await this.findById(id);
        if (!equipment)
            return null;
        await equipment.update(input);
        return equipment;
    }
    async markInactive(id) {
        return this.update(id, { estado: domain_enums_1.EquipmentStatus.INACTIVO });
    }
};
exports.EquipmentRepository = EquipmentRepository;
exports.EquipmentRepository = EquipmentRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, sequelize_1.InjectModel)(equipment_model_1.EquipmentModel)),
    __metadata("design:paramtypes", [Object])
], EquipmentRepository);
//# sourceMappingURL=equipment.repository.js.map