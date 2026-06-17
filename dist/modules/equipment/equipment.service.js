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
exports.EquipmentService = void 0;
const common_1 = require("@nestjs/common");
const equipment_repository_1 = require("./equipment.repository");
let EquipmentService = class EquipmentService {
    constructor(equipmentRepository) {
        this.equipmentRepository = equipmentRepository;
    }
    listAvailableEquipment() {
        return this.equipmentRepository.findAvailable();
    }
    createEquipment(input) {
        return this.equipmentRepository.create(input);
    }
    async updateEquipment(id, input) {
        const equipment = await this.equipmentRepository.update(id, input);
        if (!equipment) {
            throw new common_1.NotFoundException('Equipo no encontrado.');
        }
        return equipment;
    }
    async inactivateEquipment(id) {
        const equipment = await this.equipmentRepository.markInactive(id);
        if (!equipment) {
            throw new common_1.NotFoundException('Equipo no encontrado.');
        }
        return equipment;
    }
};
exports.EquipmentService = EquipmentService;
exports.EquipmentService = EquipmentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [equipment_repository_1.EquipmentRepository])
], EquipmentService);
//# sourceMappingURL=equipment.service.js.map