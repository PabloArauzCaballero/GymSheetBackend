"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportModule = void 0;
const common_1 = require("@nestjs/common");
const equipment_module_1 = require("../equipment/equipment.module");
const profiles_module_1 = require("../profiles/profiles.module");
const users_module_1 = require("../users/users.module");
const workouts_module_1 = require("../workouts/workouts.module");
const export_controller_1 = require("./export.controller");
const export_service_1 = require("./export.service");
let ExportModule = class ExportModule {
};
exports.ExportModule = ExportModule;
exports.ExportModule = ExportModule = __decorate([
    (0, common_1.Module)({
        imports: [users_module_1.UsersModule, profiles_module_1.ProfilesModule, workouts_module_1.WorkoutsModule, equipment_module_1.EquipmentModule],
        controllers: [export_controller_1.ExportController],
        providers: [export_service_1.ExportService],
    })
], ExportModule);
//# sourceMappingURL=export.module.js.map