import { z } from 'zod';

const note = z.string().trim().max(1000).nullable();

/** Un ejercicio dentro de un día. La posición la da el orden del arreglo. */
const dayExerciseSchema = z
  .object({
    ejercicioId: z.string().uuid(),
    seriesObjetivo: z.number().int().min(1).max(100).default(3),
    repsMin: z.number().int().min(1).max(1000).nullable().optional(),
    repsMax: z.number().int().min(1).max(1000).nullable().optional(),
    pesoObjetivoKg: z.number().min(0).max(2000).nullable().optional(),
    rirObjetivo: z.number().int().min(0).max(10).nullable().optional(),
    descansoSeg: z.number().int().min(0).max(7200).nullable().optional(),
    nota: note.optional(),
  })
  .refine((v) => v.repsMin == null || v.repsMax == null || v.repsMax >= v.repsMin, {
    message: 'repsMax debe ser mayor o igual a repsMin.',
  })
  .transform((v) => ({
    exerciseId: v.ejercicioId,
    targetSets: v.seriesObjetivo,
    repsMin: v.repsMin ?? null,
    repsMax: v.repsMax ?? null,
    targetWeightKg: v.pesoObjetivoKg ?? null,
    targetRir: v.rirObjetivo ?? null,
    restSeconds: v.descansoSeg ?? null,
    note: v.nota ?? null,
  }));

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
