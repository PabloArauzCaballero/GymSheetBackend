import { z } from 'zod';
import { CARDIO_MODALITIES } from './cardio-plan.model';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Fecha inválida (YYYY-MM-DD).');

const cardioPlanFields = z.object({
  nombre: z.string().trim().min(2).max(80),
  modalidad: z.enum(CARDIO_MODALITIES),
  diasSemana: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  minutosObjetivo: z.number().int().min(5).max(300),
  intensidad: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('ZONA_FC'), zona: z.number().int().min(1).max(5) }),
    z.object({ tipo: z.literal('RPE'), rpe: z.number().int().min(1).max(10) }),
  ]),
  intervalos: z
    .object({
      trabajoSeg: z.number().int().min(5).max(3600),
      descansoSeg: z.number().int().min(5).max(3600),
      rondas: z.number().int().min(1).max(50),
    })
    .nullable()
    .optional(),
  fcReposo: z.number().int().min(30).max(120).nullable().optional(),
  fcMax: z.number().int().min(120).max(230).nullable().optional(),
  progresionPctSemana: z.number().int().min(0).max(10).default(5),
});

export const cardioPlanSchema = cardioPlanFields.transform((v) => ({
  name: v.nombre,
  modality: v.modalidad,
  weekdays: [...new Set(v.diasSemana)].sort((a, b) => a - b),
  targetMinutes: v.minutosObjetivo,
  intensityType: v.intensidad.tipo,
  targetZone: v.intensidad.tipo === 'ZONA_FC' ? v.intensidad.zona : null,
  targetRpe: v.intensidad.tipo === 'RPE' ? v.intensidad.rpe : null,
  intervals: v.intervalos ?? null,
  restingHeartRate: v.fcReposo ?? null,
  maxHeartRate: v.fcMax ?? null,
  weeklyProgressionPct: v.progresionPctSemana,
}));

export const cardioPlanPatchSchema = cardioPlanFields
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Envía al menos un campo.' })
  .transform((v) => ({
    ...(v.nombre !== undefined ? { name: v.nombre } : {}),
    ...(v.modalidad !== undefined ? { modality: v.modalidad } : {}),
    ...(v.diasSemana !== undefined ? { weekdays: [...new Set(v.diasSemana)].sort((a, b) => a - b) } : {}),
    ...(v.minutosObjetivo !== undefined ? { targetMinutes: v.minutosObjetivo } : {}),
    ...(v.intensidad !== undefined
      ? {
          intensityType: v.intensidad.tipo,
          targetZone: v.intensidad.tipo === 'ZONA_FC' ? v.intensidad.zona : null,
          targetRpe: v.intensidad.tipo === 'RPE' ? v.intensidad.rpe : null,
        }
      : {}),
    ...(v.intervalos !== undefined ? { intervals: v.intervalos } : {}),
    ...(v.fcReposo !== undefined ? { restingHeartRate: v.fcReposo } : {}),
    ...(v.fcMax !== undefined ? { maxHeartRate: v.fcMax } : {}),
    ...(v.progresionPctSemana !== undefined ? { weeklyProgressionPct: v.progresionPctSemana } : {}),
  }));

export const activateCardioSchema = z
  .object({
    cardioPlanId: z.string().uuid().optional(),
    cardioPlan: cardioPlanSchema.optional(),
    fechaInicio: isoDate.optional(),
    duracionSemanas: z.number().int().min(1).max(52).default(4),
    replace: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.cardioPlanId) !== Boolean(v.cardioPlan), {
    message: 'Envía cardioPlanId o cardioPlan (uno solo).',
  })
  .transform((v) => ({
    planId: v.cardioPlanId,
    plan: v.cardioPlan,
    startDate: v.fechaInicio,
    durationWeeks: v.duracionSemanas,
    replace: v.replace,
  }));

export type CardioPlanInput = z.infer<typeof cardioPlanSchema>;
export type CardioPlanPatch = z.infer<typeof cardioPlanPatchSchema>;
export type ActivateCardioInput = z.infer<typeof activateCardioSchema>;
