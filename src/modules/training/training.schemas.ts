import { z } from 'zod';
import {
  RoutineVisibility,
  TrainingGoal,
} from '../../common/enums/domain.enums';

const nullableNote = z.string().trim().max(1000).nullable();
const routineName = z.string().trim().min(2).max(160);
const visibility = z.nativeEnum(RoutineVisibility);
const goal = z.nativeEnum(TrainingGoal);

/** One prescribed exercise. Referenced by exercise UUID or by exact name (bulk import). */
const routineExerciseInput = z
  .object({
    ejercicioId: z.string().uuid().optional(),
    ejercicioNombre: z.string().trim().min(1).max(160).optional(),
    orden: z.number().int().min(1).max(500),
    seriesObjetivo: z.number().int().min(1).max(100).default(3),
    repsMin: z.number().int().min(1).max(1000).nullable().optional(),
    repsMax: z.number().int().min(1).max(1000).nullable().optional(),
    pesoObjetivoKg: z.number().min(0).max(2000).nullable().optional(),
    rirObjetivo: z.number().int().min(0).max(10).nullable().optional(),
    descansoSeg: z.number().int().min(0).max(7200).nullable().optional(),
    nota: nullableNote.optional(),
  })
  .refine((value) => Boolean(value.ejercicioId) || Boolean(value.ejercicioNombre), {
    message: 'Cada ejercicio requiere ejercicioId o ejercicioNombre.',
  })
  .refine(
    (value) =>
      value.repsMin == null || value.repsMax == null || value.repsMax >= value.repsMin,
    { message: 'repsMax debe ser mayor o igual a repsMin.' },
  )
  .transform((value) => ({
    exerciseId: value.ejercicioId ?? null,
    exerciseName: value.ejercicioNombre ?? null,
    order: value.orden,
    targetSets: value.seriesObjetivo,
    repsMin: value.repsMin ?? null,
    repsMax: value.repsMax ?? null,
    targetWeightKg: value.pesoObjetivoKg ?? null,
    targetRir: value.rirObjetivo ?? null,
    restSeconds: value.descansoSeg ?? null,
    note: value.nota ?? null,
  }));

export const createRoutineSchema = z
  .object({
    nombre: routineName,
    descripcion: z.string().trim().max(4000).nullable().optional(),
    visibilidad: visibility.default(RoutineVisibility.PRIVATE),
    objetivo: goal.nullable().optional(),
  })
  .transform((value) => ({
    name: value.nombre,
    description: value.descripcion ?? null,
    visibility: value.visibilidad,
    goal: value.objetivo ?? null,
  }));

export const updateRoutineSchema = z
  .object({
    nombre: routineName.optional(),
    descripcion: z.string().trim().max(4000).nullable().optional(),
    visibilidad: visibility.optional(),
    objetivo: goal.nullable().optional(),
    estado: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform((value) => ({
    ...(value.nombre !== undefined ? { name: value.nombre } : {}),
    ...(value.descripcion !== undefined ? { description: value.descripcion } : {}),
    ...(value.visibilidad !== undefined ? { visibility: value.visibilidad } : {}),
    ...(value.objetivo !== undefined ? { goal: value.objetivo } : {}),
    ...(value.estado !== undefined ? { status: value.estado } : {}),
  }));

export const addRoutineExerciseSchema = routineExerciseInput;

export const updateRoutineExerciseSchema = z
  .object({
    orden: z.number().int().min(1).max(500).optional(),
    seriesObjetivo: z.number().int().min(1).max(100).optional(),
    repsMin: z.number().int().min(1).max(1000).nullable().optional(),
    repsMax: z.number().int().min(1).max(1000).nullable().optional(),
    pesoObjetivoKg: z.number().min(0).max(2000).nullable().optional(),
    rirObjetivo: z.number().int().min(0).max(10).nullable().optional(),
    descansoSeg: z.number().int().min(0).max(7200).nullable().optional(),
    nota: nullableNote.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform((value) => ({
    ...(value.orden !== undefined ? { order: value.orden } : {}),
    ...(value.seriesObjetivo !== undefined ? { targetSets: value.seriesObjetivo } : {}),
    ...(value.repsMin !== undefined ? { repsMin: value.repsMin } : {}),
    ...(value.repsMax !== undefined ? { repsMax: value.repsMax } : {}),
    ...(value.pesoObjetivoKg !== undefined ? { targetWeightKg: value.pesoObjetivoKg } : {}),
    ...(value.rirObjetivo !== undefined ? { targetRir: value.rirObjetivo } : {}),
    ...(value.descansoSeg !== undefined ? { restSeconds: value.descansoSeg } : {}),
    ...(value.nota !== undefined ? { note: value.nota } : {}),
  }));

export const assignRoutineSchema = z
  .object({
    clienteUsuarioId: z.string().uuid(),
    fechaProgramada: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Fecha inválida (YYYY-MM-DD).')
      .nullable()
      .optional(),
    diasSemana: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    nota: nullableNote.optional(),
  })
  .transform((value) => ({
    clientUserId: value.clienteUsuarioId,
    scheduledFor: value.fechaProgramada ?? null,
    weekdays: Array.from(new Set(value.diasSemana)).sort((a, b) => a - b),
    note: value.nota ?? null,
  }));

/** Bulk import of one or more full routines (each with its prescribed exercises). */
export const importRoutinesSchema = z
  .object({
    rutinas: z
      .array(
        z.object({
          nombre: routineName,
          descripcion: z.string().trim().max(4000).nullable().optional(),
          visibilidad: visibility.default(RoutineVisibility.PRIVATE),
          objetivo: goal.nullable().optional(),
          ejercicios: z.array(routineExerciseInput).min(1).max(100),
        }),
      )
      .min(1)
      .max(200),
  })
  .transform((value) => ({
    routines: value.rutinas.map((routine) => ({
      name: routine.nombre,
      description: routine.descripcion ?? null,
      visibility: routine.visibilidad,
      goal: routine.objetivo ?? null,
      exercises: routine.ejercicios,
    })),
  }));

export const listRoutinesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  scope: z.enum(['mine', 'templates']).default('mine'),
});

export type RoutineExerciseInput = z.infer<typeof routineExerciseInput>;
export type CreateRoutineInput = z.infer<typeof createRoutineSchema>;
export type UpdateRoutineInput = z.infer<typeof updateRoutineSchema>;
export type UpdateRoutineExerciseInput = z.infer<typeof updateRoutineExerciseSchema>;

/**
 * Auto-programación de una rutina por el propio cliente.
 *
 * A diferencia de `assignRoutineSchema`, aquí no hay `clienteUsuarioId`: el
 * destinatario es siempre quien llama, y aceptarlo por cuerpo permitiría que un
 * cliente programase rutinas en la agenda de otro.
 *
 * La ventana es lo que convierte "esta rutina me interesa" en un mesociclo:
 * sin `repiteHasta` el plan es indefinido, que sigue siendo válido.
 */
export const selfScheduleRoutineSchema = z
  .object({
    diasSemana: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    repiteDesde: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Fecha inválida (YYYY-MM-DD).')
      .nullable()
      .optional(),
    repiteHasta: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Fecha inválida (YYYY-MM-DD).')
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      !value.repiteDesde ||
      !value.repiteHasta ||
      value.repiteHasta >= value.repiteDesde,
    { message: 'La fecha final no puede ser anterior a la inicial.', path: ['repiteHasta'] },
  )
  .transform((value) => ({
    weekdays: value.diasSemana,
    repeatsFrom: value.repiteDesde ?? null,
    repeatsUntil: value.repiteHasta ?? null,
  }));

export type SelfScheduleRoutineInput = z.infer<typeof selfScheduleRoutineSchema>;

export type AssignRoutineInput = z.infer<typeof assignRoutineSchema>;
export type ImportRoutinesInput = z.infer<typeof importRoutinesSchema>;
export type ListRoutinesInput = z.infer<typeof listRoutinesSchema>;
