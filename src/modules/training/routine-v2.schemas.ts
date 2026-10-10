import { z } from 'zod';
import type { RoutineGroupType } from './routine-exercise.model';

const note = z.string().trim().max(1000).nullable();

/**
 * Topes de UX para rutinas nuevas o editadas (C3.a). La base sigue admitiendo
 * hasta 100 series para no invalidar rutinas antiguas; las copias no pasan por aquí.
 */
export const MAX_SETS = 10;
export const MAX_REPS = 50;
export const sets = z.number().int().min(1).max(MAX_SETS);
export const reps = z.number().int().min(1).max(MAX_REPS);
/** Bloque (superserie/circuito) dentro del día: mismo número = mismo bloque. */
export const group = z.number().int().min(1).max(30);
export const restBetween = z.number().int().min(0).max(60);
export const duration = z.number().int().min(1).max(3600);

/** Un ejercicio dentro de un día. La posición la da el orden del arreglo. */
const dayExerciseSchema = z
  .object({
    ejercicioId: z.string().uuid(),
    seriesObjetivo: sets.default(3),
    repsMin: reps.nullable().optional(),
    repsMax: reps.nullable().optional(),
    pesoObjetivoKg: z.number().min(0).max(2000).nullable().optional(),
    rirObjetivo: z.number().int().min(0).max(10).nullable().optional(),
    descansoSeg: z.number().int().min(0).max(7200).nullable().optional(),
    nota: note.optional(),
    grupo: group.nullable().optional(),
    descansoEntreSeg: restBetween.nullable().optional(),
    duracionSeg: duration.nullable().optional(),
  })
  .refine((v) => v.repsMin == null || v.repsMax == null || v.repsMax >= v.repsMin, {
    message: 'repsMax debe ser mayor o igual a repsMin.',
  })
  .transform((v) => {
    // Serie por tiempo: la duración manda y las reps quedan vacías.
    const timed = v.duracionSeg != null;
    return {
      exerciseId: v.ejercicioId,
      targetSets: v.seriesObjetivo,
      repsMin: timed ? null : (v.repsMin ?? null),
      repsMax: timed ? null : (v.repsMax ?? null),
      targetWeightKg: v.pesoObjetivoKg ?? null,
      targetRir: v.rirObjetivo ?? null,
      restSeconds: v.descansoSeg ?? null,
      note: v.nota ?? null,
      group: v.grupo ?? null,
      groupType: null as RoutineGroupType | null,
      restBetweenSeconds: v.descansoEntreSeg ?? null,
      durationSeconds: v.duracionSeg ?? null,
    };
  });

export const routineDaySchema = z
  .object({
    diaSemana: z.number().int().min(1).max(7).nullable(),
    nombre: z.string().trim().max(60).nullable().optional(),
    ejercicios: z.array(dayExerciseSchema).max(60),
  })
  .transform((v) => ({
    weekday: v.diaSemana,
    name: v.nombre ?? null,
    exercises: v.ejercicios,
  }));

export const progressionSchema = z
  .object({
    activa: z.boolean().default(true),
    descargaCada: z.union([z.literal(4), z.literal(5), z.literal(6)]).nullable().default(4),
    volumenDescarga: z.number().min(0.3).max(1).default(0.5),
    cargaDescarga: z.number().min(0.5).max(1).default(0.9),
  });

const uniqueWeekdays = (days: ReadonlyArray<{ weekday: number | null }>): boolean => {
  const set = days.map((d) => d.weekday).filter((d): d is number => d !== null);
  return new Set(set).size === set.length;
};

export const durationWeeksSchema = z.number().int().min(1).max(52);

export const routineStructureSchema = z
  .object({ dias: z.array(routineDaySchema).min(1).max(7) })
  .refine((v) => uniqueWeekdays(v.dias), { message: 'No puede haber dos días con el mismo día de la semana.' })
  .transform((v) => ({ days: v.dias }));

export const weekOverrideSchema = z
  .object({
    esDescarga: z.boolean(),
    factorVolumen: z.number().min(0.3).max(1.5).default(1),
    factorCarga: z.number().min(0.5).max(1.2).default(1),
    nota: z.string().trim().max(200).nullable().optional(),
  })
  .transform((v) => ({
    isDeload: v.esDescarga,
    volumeFactor: v.factorVolumen,
    loadFactor: v.factorCarga,
    note: v.nota ?? null,
  }));

export const calendarQuerySchema = z.object({
  semanas: z.coerce.number().int().min(1).max(52).optional(),
});

export type RoutineDayInput = z.infer<typeof routineDaySchema>;
export type RoutineStructureInput = z.infer<typeof routineStructureSchema>;
export type ProgressionInput = z.infer<typeof progressionSchema>;
export type WeekOverrideInput = z.infer<typeof weekOverrideSchema>;
export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;
export { uniqueWeekdays };

export const inviteSchema = z
  .object({ usuarioIds: z.array(z.string().uuid()).min(1).max(20) })
  .transform((v) => ({ userIds: v.usuarioIds }));

export const invitationListQuerySchema = z.object({
  estado: z.enum(['PENDING', 'ACCEPTED']).optional(),
});

export type InviteInput = z.infer<typeof inviteSchema>;
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;

export const adminRoutineListQuerySchema = z.object({
  oficial: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  estadoModeracion: z.enum(['VISIBLE', 'OCULTA_AUTO', 'OCULTA_MODERACION']).optional(),
  autor: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AdminRoutineListQuery = z.infer<typeof adminRoutineListQuerySchema>;
