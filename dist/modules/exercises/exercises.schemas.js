"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exerciseFilterSchema = exports.updateExerciseSchema = exports.createPersonalExerciseSchema = exports.createGlobalExerciseSchema = exports.equipmentIdsSchema = void 0;
const zod_1 = require("zod");
exports.equipmentIdsSchema = zod_1.z.array(zod_1.z.string().uuid()).default([]);
exports.createGlobalExerciseSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(160),
    grupoMuscular: zod_1.z.string().min(2).max(100),
    descripcion: zod_1.z.string().max(1000).optional().nullable(),
    equipoIds: exports.equipmentIdsSchema.optional(),
});
exports.createPersonalExerciseSchema = exports.createGlobalExerciseSchema;
exports.updateExerciseSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(160).optional(),
    grupoMuscular: zod_1.z.string().min(2).max(100).optional(),
    descripcion: zod_1.z.string().max(1000).optional().nullable(),
    equipoIds: exports.equipmentIdsSchema.optional(),
});
exports.exerciseFilterSchema = zod_1.z.object({
    grupoMuscular: zod_1.z.string().max(100).optional(),
    equipoId: zod_1.z.string().uuid().optional(),
});
//# sourceMappingURL=exercises.schemas.js.map