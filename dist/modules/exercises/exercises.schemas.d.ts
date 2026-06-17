import { z } from 'zod';
export declare const equipmentIdsSchema: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
export declare const createGlobalExerciseSchema: z.ZodObject<{
    nombre: z.ZodString;
    grupoMuscular: z.ZodString;
    descripcion: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    equipoIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    nombre: string;
    grupoMuscular: string;
    descripcion?: string | null | undefined;
    equipoIds?: string[] | undefined;
}, {
    nombre: string;
    grupoMuscular: string;
    descripcion?: string | null | undefined;
    equipoIds?: string[] | undefined;
}>;
export declare const createPersonalExerciseSchema: z.ZodObject<{
    nombre: z.ZodString;
    grupoMuscular: z.ZodString;
    descripcion: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    equipoIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    nombre: string;
    grupoMuscular: string;
    descripcion?: string | null | undefined;
    equipoIds?: string[] | undefined;
}, {
    nombre: string;
    grupoMuscular: string;
    descripcion?: string | null | undefined;
    equipoIds?: string[] | undefined;
}>;
export declare const updateExerciseSchema: z.ZodObject<{
    nombre: z.ZodOptional<z.ZodString>;
    grupoMuscular: z.ZodOptional<z.ZodString>;
    descripcion: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    equipoIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    nombre?: string | undefined;
    grupoMuscular?: string | undefined;
    descripcion?: string | null | undefined;
    equipoIds?: string[] | undefined;
}, {
    nombre?: string | undefined;
    grupoMuscular?: string | undefined;
    descripcion?: string | null | undefined;
    equipoIds?: string[] | undefined;
}>;
export declare const exerciseFilterSchema: z.ZodObject<{
    grupoMuscular: z.ZodOptional<z.ZodString>;
    equipoId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    grupoMuscular?: string | undefined;
    equipoId?: string | undefined;
}, {
    grupoMuscular?: string | undefined;
    equipoId?: string | undefined;
}>;
export type CreateGlobalExerciseInput = z.infer<typeof createGlobalExerciseSchema>;
export type CreatePersonalExerciseInput = z.infer<typeof createPersonalExerciseSchema>;
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;
export type ExerciseFilterInput = z.infer<typeof exerciseFilterSchema>;
