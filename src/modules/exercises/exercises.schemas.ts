import { z } from 'zod';

export const equipmentIdsSchema = z.array(z.string().uuid()).default([]);

export const createGlobalExerciseSchema = z.object({
  nombre: z.string().min(2).max(160),
  grupoMuscular: z.string().min(2).max(100),
  descripcion: z.string().max(1000).optional().nullable(),
  equipoIds: equipmentIdsSchema.optional(),
});

export const createPersonalExerciseSchema = createGlobalExerciseSchema;

export const updateExerciseSchema = z.object({
  nombre: z.string().min(2).max(160).optional(),
  grupoMuscular: z.string().min(2).max(100).optional(),
  descripcion: z.string().max(1000).optional().nullable(),
  equipoIds: equipmentIdsSchema.optional(),
});

export const exerciseFilterSchema = z.object({
  grupoMuscular: z.string().max(100).optional(),
  equipoId: z.string().uuid().optional(),
});

export type CreateGlobalExerciseInput = z.infer<typeof createGlobalExerciseSchema>;
export type CreatePersonalExerciseInput = z.infer<typeof createPersonalExerciseSchema>;
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;
export type ExerciseFilterInput = z.infer<typeof exerciseFilterSchema>;
