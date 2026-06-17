"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateWorkoutSetSchema = exports.createWorkoutSetSchema = exports.updateSessionExerciseSchema = exports.addSessionExerciseSchema = exports.createWorkoutSessionSchema = void 0;
const zod_1 = require("zod");
exports.createWorkoutSessionSchema = zod_1.z.object({
    observacion: zod_1.z.string().max(1000).optional().nullable(),
});
exports.addSessionExerciseSchema = zod_1.z.object({
    ejercicioId: zod_1.z.string().uuid(),
    orden: zod_1.z.number().int().min(1),
    esEnfasis: zod_1.z.boolean().default(false),
    nota: zod_1.z.string().max(1000).optional().nullable(),
});
exports.updateSessionExerciseSchema = zod_1.z.object({
    orden: zod_1.z.number().int().min(1).optional(),
    esEnfasis: zod_1.z.boolean().optional(),
    nota: zod_1.z.string().max(1000).optional().nullable(),
});
exports.createWorkoutSetSchema = zod_1.z.object({
    numeroSerie: zod_1.z.number().int().min(1),
    repeticiones: zod_1.z.number().int().min(1),
    pesoKg: zod_1.z.number().min(0).max(2000),
    rir: zod_1.z.number().int().min(0).max(10),
    descansoSegAnterior: zod_1.z.number().int().min(0).max(7200),
});
exports.updateWorkoutSetSchema = exports.createWorkoutSetSchema.partial();
//# sourceMappingURL=workouts.schemas.js.map