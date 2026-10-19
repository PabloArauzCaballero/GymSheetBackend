import { z } from 'zod';
import { reps, sets } from '../training/routine-v2.schemas';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Fecha inválida (YYYY-MM-DD).');

export const liftTargetSchema = z
  .object({
    ejercicioId: z.string().uuid(),
    pesoTrabajoKg: z.number().min(0).max(1000).optional(),
    repsMin: z.number().int().min(1).max(50).optional(),
    repsMax: z.number().int().min(1).max(50).optional(),
    rirObjetivo: z.number().int().min(0).max(5).nullable().optional(),
    marcaMetaKg: z.number().positive().max(1000).optional(),
    fechaMeta: isoDate.optional(),
    marcaActual: z.object({ pesoKg: z.number().positive().max(1000), reps: z.number().int().min(1).max(30) }).optional(),
  })
  .refine((v) => v.repsMin == null || v.repsMax == null || v.repsMax >= v.repsMin, {
    message: 'repsMax debe ser mayor o igual a repsMin.',
  })
  .transform((v) => ({
    exerciseId: v.ejercicioId,
    workingWeightKg: v.pesoTrabajoKg,
    repsMin: v.repsMin,
    repsMax: v.repsMax,
    rirTarget: v.rirObjetivo ?? null,
    goalKg: v.marcaMetaKg,
    goalDate: v.fechaMeta,
    current: v.marcaActual ? { weightKg: v.marcaActual.pesoKg, reps: v.marcaActual.reps } : undefined,
  }));

export const activateStrengthSchema = z
  .object({
    routineId: z.string().uuid(),
    fechaInicio: isoDate.optional(),
    duracionSemanas: z.number().int().min(1).max(52).optional(),
    modo: z.enum(['NONE', 'PROGRESSIVE_OVERLOAD', 'STRENGTH_GOALS']),
    liftTargets: z.array(liftTargetSchema).max(30).optional(),
    diasSemana: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    replace: z.boolean().default(false),
  })
  .transform((v) => ({
    routineId: v.routineId,
    startDate: v.fechaInicio,
    durationWeeks: v.duracionSemanas,
    mode: v.modo,
    liftTargets: v.liftTargets,
    weekdays: v.diasSemana ? [...new Set(v.diasSemana)].sort((a, b) => a - b) : undefined,
    replace: v.replace,
  }));

export const closeProgramSchema = z
  .object({ accion: z.enum(['REPEAT', 'CHOOSE_OTHER', 'STOP']) })
  .transform((v) => ({ action: v.accion }));

export const applyToRoutineSchema = z
  .object({
    cambios: z
      .array(
        z.object({
          routineExerciseId: z.string().uuid(),
          pesoObjetivoKg: z.number().min(0).max(2000).nullable().optional(),
          seriesObjetivo: sets.optional(),
          repsMin: reps.nullable().optional(),
          repsMax: reps.nullable().optional(),
        }),
      )
      .max(60)
      .default([]),
    agregar: z
      .array(
        z.object({
          ejercicioId: z.string().uuid(),
          seriesObjetivo: sets.default(3),
          repsMin: reps.nullable().optional(),
          repsMax: reps.nullable().optional(),
          pesoObjetivoKg: z.number().min(0).max(2000).nullable().optional(),
        }),
      )
      .max(30)
      .default([]),
    quitar: z.array(z.string().uuid()).max(60).default([]),
  })
  .refine((v) => v.cambios.length + v.agregar.length + v.quitar.length > 0, {
    message: 'No hay cambios que aplicar.',
  });

export type ActivateStrengthInput = z.infer<typeof activateStrengthSchema>;
export type LiftTargetInput = ActivateStrengthInput['liftTargets'] extends infer T
  ? T extends ReadonlyArray<infer U>
    ? U
    : never
  : never;
export type CloseProgramInput = z.infer<typeof closeProgramSchema>;
export type ApplyToRoutineInput = z.infer<typeof applyToRoutineSchema>;
