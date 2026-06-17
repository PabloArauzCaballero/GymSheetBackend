import { z } from 'zod';
export declare const createWorkoutSessionSchema: z.ZodObject<{
    observacion: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    observacion?: string | null | undefined;
}, {
    observacion?: string | null | undefined;
}>;
export declare const addSessionExerciseSchema: z.ZodObject<{
    ejercicioId: z.ZodString;
    orden: z.ZodNumber;
    esEnfasis: z.ZodDefault<z.ZodBoolean>;
    nota: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    ejercicioId: string;
    orden: number;
    esEnfasis: boolean;
    nota?: string | null | undefined;
}, {
    ejercicioId: string;
    orden: number;
    esEnfasis?: boolean | undefined;
    nota?: string | null | undefined;
}>;
export declare const updateSessionExerciseSchema: z.ZodObject<{
    orden: z.ZodOptional<z.ZodNumber>;
    esEnfasis: z.ZodOptional<z.ZodBoolean>;
    nota: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    orden?: number | undefined;
    esEnfasis?: boolean | undefined;
    nota?: string | null | undefined;
}, {
    orden?: number | undefined;
    esEnfasis?: boolean | undefined;
    nota?: string | null | undefined;
}>;
export declare const createWorkoutSetSchema: z.ZodObject<{
    numeroSerie: z.ZodNumber;
    repeticiones: z.ZodNumber;
    pesoKg: z.ZodNumber;
    rir: z.ZodNumber;
    descansoSegAnterior: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    pesoKg: number;
    numeroSerie: number;
    repeticiones: number;
    rir: number;
    descansoSegAnterior: number;
}, {
    pesoKg: number;
    numeroSerie: number;
    repeticiones: number;
    rir: number;
    descansoSegAnterior: number;
}>;
export declare const updateWorkoutSetSchema: z.ZodObject<{
    numeroSerie: z.ZodOptional<z.ZodNumber>;
    repeticiones: z.ZodOptional<z.ZodNumber>;
    pesoKg: z.ZodOptional<z.ZodNumber>;
    rir: z.ZodOptional<z.ZodNumber>;
    descansoSegAnterior: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    pesoKg?: number | undefined;
    numeroSerie?: number | undefined;
    repeticiones?: number | undefined;
    rir?: number | undefined;
    descansoSegAnterior?: number | undefined;
}, {
    pesoKg?: number | undefined;
    numeroSerie?: number | undefined;
    repeticiones?: number | undefined;
    rir?: number | undefined;
    descansoSegAnterior?: number | undefined;
}>;
export type CreateWorkoutSessionInput = z.infer<typeof createWorkoutSessionSchema>;
export type AddSessionExerciseInput = z.infer<typeof addSessionExerciseSchema>;
export type UpdateSessionExerciseInput = z.infer<typeof updateSessionExerciseSchema>;
export type CreateWorkoutSetInput = z.infer<typeof createWorkoutSetSchema>;
export type UpdateWorkoutSetInput = z.infer<typeof updateWorkoutSetSchema>;
