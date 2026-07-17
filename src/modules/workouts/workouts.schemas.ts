import { z } from 'zod';

const nullableNoteSchema = z.string().trim().max(1000).nullable();

export const createWorkoutSessionSchema = z
  .object({
    observacion: nullableNoteSchema.optional(),
  })
  .transform(({ observacion }) => ({ observation: observacion ?? null }));

export const workoutSessionListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

export const addSessionExerciseSchema = z
  .object({
    ejercicioId: z.string().uuid(),
    orden: z.number().int().min(1).max(500),
    esEnfasis: z.boolean().default(false),
    nota: nullableNoteSchema.optional(),
  })
  .transform(({ ejercicioId, orden, esEnfasis, nota }) => ({
    exerciseId: ejercicioId,
    order: orden,
    isEmphasis: esEnfasis,
    note: nota ?? null,
  }));

export const updateSessionExerciseSchema = z
  .object({
    orden: z.number().int().min(1).max(500).optional(),
    esEnfasis: z.boolean().optional(),
    nota: nullableNoteSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform(({ orden, esEnfasis, nota }) => ({
    ...(orden !== undefined ? { order: orden } : {}),
    ...(esEnfasis !== undefined ? { isEmphasis: esEnfasis } : {}),
    ...(nota !== undefined ? { note: nota } : {}),
  }));

export const createWorkoutSetSchema = z
  .object({
    numeroSerie: z.number().int().min(1).max(100),
    repeticiones: z.number().int().min(1).max(1000),
    pesoKg: z.number().min(0).max(2000),
    rir: z.number().int().min(0).max(10),
    descansoSegAnterior: z.number().int().min(0).max(7200),
  })
  .transform(({ numeroSerie, repeticiones, pesoKg, rir, descansoSegAnterior }) => ({
    setNumber: numeroSerie,
    repetitions: repeticiones,
    weightKg: pesoKg,
    rir,
    previousRestSeconds: descansoSegAnterior,
  }));

export const updateWorkoutSetSchema = z
  .object({
    numeroSerie: z.number().int().min(1).max(100).optional(),
    repeticiones: z.number().int().min(1).max(1000).optional(),
    pesoKg: z.number().min(0).max(2000).optional(),
    rir: z.number().int().min(0).max(10).optional(),
    descansoSegAnterior: z.number().int().min(0).max(7200).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform(({ numeroSerie, repeticiones, pesoKg, rir, descansoSegAnterior }) => ({
    ...(numeroSerie !== undefined ? { setNumber: numeroSerie } : {}),
    ...(repeticiones !== undefined ? { repetitions: repeticiones } : {}),
    ...(pesoKg !== undefined ? { weightKg: pesoKg } : {}),
    ...(rir !== undefined ? { rir } : {}),
    ...(descansoSegAnterior !== undefined
      ? { previousRestSeconds: descansoSegAnterior }
      : {}),
  }));

export type CreateWorkoutSessionInput = z.infer<typeof createWorkoutSessionSchema>;
export type WorkoutSessionListInput = z.infer<typeof workoutSessionListSchema>;
export type AddSessionExerciseInput = z.infer<typeof addSessionExerciseSchema>;
export type UpdateSessionExerciseInput = z.infer<typeof updateSessionExerciseSchema>;
export type CreateWorkoutSetInput = z.infer<typeof createWorkoutSetSchema>;
export type UpdateWorkoutSetInput = z.infer<typeof updateWorkoutSetSchema>;
