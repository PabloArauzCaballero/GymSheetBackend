import { z } from 'zod';

const nullableNoteSchema = z.string().trim().max(1000).nullable();

export const createWorkoutSessionSchema = z
  .object({
    observacion: nullableNoteSchema.optional(),
  })
  .transform(({ observacion }) => ({ observation: observacion ?? null }));

/**
 * Ubicación opcional al finalizar una sesión, para la verificación de racha
 * por geolocalización (solo móvil; ver `202608250003-streak-geo-verification`).
 * Ausente = el cliente no la pidió o el usuario no dio permiso; la sesión se
 * finaliza igual, sin verificar.
 */
export const finishSessionSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .optional()
  .default({});

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

const strengthSetShape = z.object({
  tipoSerie: z.literal('FUERZA'),
  numeroSerie: z.number().int().min(1).max(100),
  repeticiones: z.number().int().min(1).max(1000),
  pesoKg: z.number().min(0).max(2000),
  rir: z.number().int().min(0).max(10),
  descansoSegAnterior: z.number().int().min(0).max(7200),
});

/** Serie de cardio (RF-17): lo único obligatorio es cuánto duró. */
const cardioSetShape = z.object({
  tipoSerie: z.literal('CARDIO'),
  numeroSerie: z.number().int().min(1).max(100),
  duracionSeg: z.number().int().min(1).max(86400),
  distanciaM: z.number().int().min(0).max(500000).optional(),
  fcMedia: z.number().int().min(30).max(230).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  descansoSegAnterior: z.number().int().min(0).max(7200).default(0),
});

/**
 * `tipoSerie` es opcional en la entrada para no romper a las apps instaladas,
 * que no lo envían: sin él la serie es de fuerza, como siempre.
 */
export const createWorkoutSetSchema = z
  .preprocess(
    (raw) =>
      typeof raw === 'object' && raw !== null && !('tipoSerie' in raw)
        ? { ...(raw as Record<string, unknown>), tipoSerie: 'FUERZA' }
        : raw,
    z.discriminatedUnion('tipoSerie', [strengthSetShape, cardioSetShape]),
  )
  .transform((input) =>
    input.tipoSerie === 'FUERZA'
      ? {
          type: 'FUERZA' as const,
          setNumber: input.numeroSerie,
          repetitions: input.repeticiones,
          weightKg: input.pesoKg,
          rir: input.rir,
          previousRestSeconds: input.descansoSegAnterior,
        }
      : {
          type: 'CARDIO' as const,
          setNumber: input.numeroSerie,
          durationSeconds: input.duracionSeg,
          distanceM: input.distanciaM ?? null,
          avgHeartRate: input.fcMedia ?? null,
          rpe: input.rpe ?? null,
          previousRestSeconds: input.descansoSegAnterior,
        },
  );

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

export type FinishSessionInput = z.infer<typeof finishSessionSchema>;
export type CreateWorkoutSessionInput = z.infer<typeof createWorkoutSessionSchema>;
export type WorkoutSessionListInput = z.infer<typeof workoutSessionListSchema>;
export type AddSessionExerciseInput = z.infer<typeof addSessionExerciseSchema>;
export type UpdateSessionExerciseInput = z.infer<typeof updateSessionExerciseSchema>;
export type CreateWorkoutSetInput = z.infer<typeof createWorkoutSetSchema>;
export type UpdateWorkoutSetInput = z.infer<typeof updateWorkoutSetSchema>;
