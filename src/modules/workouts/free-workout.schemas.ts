import { z } from 'zod';
import {
  FREE_WORKOUT_DEFAULT_SIZE,
  FREE_WORKOUT_GROUPS,
  FREE_WORKOUT_MAX_SIZE,
  FREE_WORKOUT_MIN_SIZE,
  SWAP_REASONS,
  SWAP_SCOPES,
} from './free-workout';

const MAX_OBSERVATION = 1000;
const MAX_SWAP_NOTE = 280;
const MAX_ALTERNATIVES = 30;
const DEFAULT_ALTERNATIVES = 12;

/**
 * Rutina libre: zonas opcionales y cuántos ejercicios proponer. Sin zonas,
 * cuerpo completo. `vacia: true` empieza en blanco (lo de siempre).
 */
export const startFreeWorkoutSchema = z
  .object({
    grupos: z.array(z.enum(FREE_WORKOUT_GROUPS)).max(FREE_WORKOUT_GROUPS.length).default([]),
    ejercicios: z
      .number()
      .int()
      .min(FREE_WORKOUT_MIN_SIZE)
      .max(FREE_WORKOUT_MAX_SIZE)
      .default(FREE_WORKOUT_DEFAULT_SIZE),
    vacia: z.boolean().default(false),
    observacion: z.string().trim().max(MAX_OBSERVATION).nullable().optional(),
  })
  .strict()
  .transform(({ grupos, ejercicios, vacia, observacion }) => ({
    groups: [...new Set(grupos)],
    size: ejercicios,
    empty: vacia,
    observation: observacion ?? null,
  }));

/** Equivalentes de un ejercicio de la sesión; el motivo cambia el orden. */
export const alternativesQuerySchema = z
  .object({
    motivo: z.enum(SWAP_REASONS).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_ALTERNATIVES).default(DEFAULT_ALTERNATIVES),
  })
  .transform(({ motivo, limit }) => ({ reason: motivo, limit }));

/** Cambiar un ejercicio de la sesión por otro, con motivo y alcance. */
export const swapSessionExerciseSchema = z
  .object({
    ejercicioId: z.string().uuid(),
    motivo: z.enum(SWAP_REASONS),
    alcance: z.enum(SWAP_SCOPES).default('SESION'),
    nota: z.string().trim().max(MAX_SWAP_NOTE).nullable().optional(),
  })
  .strict()
  .transform(({ ejercicioId, motivo, alcance, nota }) => ({
    exerciseId: ejercicioId,
    reason: motivo,
    scope: alcance,
    note: nota || null,
  }));

export type StartFreeWorkoutInput = z.infer<typeof startFreeWorkoutSchema>;
export type AlternativesQueryInput = z.infer<typeof alternativesQuerySchema>;
export type SwapSessionExerciseInput = z.infer<typeof swapSessionExerciseSchema>;
