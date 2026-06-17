"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateEquipmentSchema = exports.createEquipmentSchema = void 0;
const zod_1 = require("zod");
const domain_enums_1 = require("../../common/enums/domain.enums");
exports.createEquipmentSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(140),
    tipo: zod_1.z.nativeEnum(domain_enums_1.EquipmentType),
    descripcion: zod_1.z.string().max(500).optional().nullable(),
});
exports.updateEquipmentSchema = exports.createEquipmentSchema.partial().extend({
    estado: zod_1.z.nativeEnum(domain_enums_1.EquipmentStatus).optional(),
});
//# sourceMappingURL=equipment.schemas.js.map