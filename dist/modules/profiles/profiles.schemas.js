"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertProfileSchema = void 0;
const zod_1 = require("zod");
const domain_enums_1 = require("../../common/enums/domain.enums");
exports.upsertProfileSchema = zod_1.z.object({
    edad: zod_1.z.number().int().min(12).max(100),
    pesoKg: zod_1.z.number().min(1).max(400),
    estaturaCm: zod_1.z.number().int().min(80).max(250),
    objetivo: zod_1.z.nativeEnum(domain_enums_1.TrainingGoal),
});
//# sourceMappingURL=profiles.schemas.js.map