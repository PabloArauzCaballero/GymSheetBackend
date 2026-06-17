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
exports.AdminEquipmentController = exports.EquipmentController = void 0;
const common_1 = require("@nestjs/common");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const domain_enums_1 = require("../../common/enums/domain.enums");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const equipment_service_1 = require("./equipment.service");
const equipment_schemas_1 = require("./equipment.schemas");
let EquipmentController = class EquipmentController {
    constructor(equipmentService) {
        this.equipmentService = equipmentService;
    }
    listAvailableEquipment() {
        return this.equipmentService.listAvailableEquipment();
    }
};
exports.EquipmentController = EquipmentController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], EquipmentController.prototype, "listAvailableEquipment", null);
exports.EquipmentController = EquipmentController = __decorate([
    (0, common_1.Controller)('equipment'),
    __metadata("design:paramtypes", [equipment_service_1.EquipmentService])
], EquipmentController);
let AdminEquipmentController = class AdminEquipmentController {
    constructor(equipmentService) {
        this.equipmentService = equipmentService;
    }
    createEquipment(input) {
        return this.equipmentService.createEquipment(input);
    }
    updateEquipment(id, input) {
        return this.equipmentService.updateEquipment(id, input);
    }
    inactivateEquipment(id) {
        return this.equipmentService.inactivateEquipment(id);
    }
};
exports.AdminEquipmentController = AdminEquipmentController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(equipment_schemas_1.createEquipmentSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminEquipmentController.prototype, "createEquipment", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(equipment_schemas_1.updateEquipmentSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminEquipmentController.prototype, "updateEquipment", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminEquipmentController.prototype, "inactivateEquipment", null);
exports.AdminEquipmentController = AdminEquipmentController = __decorate([
    (0, roles_decorator_1.Roles)(domain_enums_1.UserRole.ADMIN),
    (0, common_1.Controller)('admin/equipment'),
    __metadata("design:paramtypes", [equipment_service_1.EquipmentService])
], AdminEquipmentController);
//# sourceMappingURL=equipment.controller.js.map