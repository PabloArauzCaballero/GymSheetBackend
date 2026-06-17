import { z } from 'zod';

export const createWorkoutSessionSchema = z.object({
  observacion: z.string().max(1000).optional().nullable(),
});

export const addSessionExerciseSchema = z.object({
  ejercicioId: z.string().uuid(),
  orden: z.number().int().min(1),
  esEnfasis: z.boolean().default(false),
  nota: z.string().max(1000).optional().nullable(),
});

export const updateSessionExerciseSchema = z.object({
  orden: z.number().int().min(1).optional(),
  esEnfasis: z.boolean().optional(),
  nota: z.string().max(1000).optional().nullable(),
});

export const createWorkoutSetSchema = z.object({
  numeroSerie: z.number().int().min(1),
  repeticiones: z.number().int().min(1),
  pesoKg: z.number().min(0).max(2000),
  rir: z.number().int().min(0).max(10),
  descansoSegAnterior: z.number().int().min(0).max(7200),
});

export const updateWorkoutSetSchema = createWorkoutSetSchema.partial();

export type CreateWorkoutSessionInput = z.infer<typeof createWorkoutSessionSchema>;
export type AddSessionExerciseInput = z.infer<typeof addSessionExerciseSchema>;
export type UpdateSessionExerciseInput = z.infer<typeof updateSessionExerciseSchema>;
export type CreateWorkoutSetInput = z.infer<typeof createWorkoutSetSchema>;
export type UpdateWorkoutSetInput = z.infer<typeof updateWorkoutSetSchema>;
