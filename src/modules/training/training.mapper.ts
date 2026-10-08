import {
  RoutineAssignmentStatus,
  RoutineStatus,
  RoutineVisibility,
  TrainingGoal,
} from '../../common/enums/domain.enums';
import { ExerciseResponse, mapExerciseToResponse } from '../exercises/exercise.mapper';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineAttribution, RoutineModel } from './routine.model';

export type RoutineExerciseResponse = {
  id: string;
  orden: number;
  seriesObjetivo: number;
  repsMin: number | null;
  repsMax: number | null;
  pesoObjetivoKg: number | null;
  rirObjetivo: number | null;
  descansoSeg: number | null;
  nota: string | null;
  ejercicio: ExerciseResponse | null;
};

export type RoutineDayResponse = {
  id: string;
  diaSemana: number | null;
  nombre: string | null;
  orden: number;
  ejercicios: RoutineExerciseResponse[];
};

export type RoutineResponse = {
  id: string;
  nombre: string;
  descripcion: string | null;
  creadoPorUsuarioId: string;
  visibilidad: RoutineVisibility;
  objetivo: TrainingGoal | null;
  estado: RoutineStatus;
  ejercicios: RoutineExerciseResponse[];
  dias: RoutineDayResponse[];
  duracionSemanas: number | null;
  progresion: Record<string, unknown>;
  esOficial: boolean;
  atribucion: RoutineAttribution | null;
  basadaEnRutinaId: string | null;
  basadaEnVersion: number | null;
  version: number;
  huellaCorta: string | null;
  valoracion: { promedio: number | null; total: number };
  copias: number;
  publicadaEn: Date | null;
  estadoModeracion: string;
  esMia: boolean;
  puedoEditar: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;
};

export type RoutineAssignmentResponse = {
  id: string;
  rutinaId: string;
  clienteUsuarioId: string;
  asignadoPorUsuarioId: string;
  estado: RoutineAssignmentStatus;
  fechaProgramada: string | null;
  diasSemana: number[];
  repiteDesde: string | null;
  repiteHasta: string | null;
  nota: string | null;
  clienteNombre: string | null;
  clienteEmail: string | null;
  rutina: RoutineResponse | null;
  fechaCreacion: Date;
};

export type RoutinePageResponse = {
  items: RoutineResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function mapRoutineExerciseToResponse(
  routineExercise: RoutineExerciseModel,
): RoutineExerciseResponse {
  return {
    id: routineExercise.id,
    orden: routineExercise.order,
    seriesObjetivo: routineExercise.targetSets,
    repsMin: routineExercise.repsMin,
    repsMax: routineExercise.repsMax,
    pesoObjetivoKg:
      routineExercise.targetWeightKg == null ? null : Number(routineExercise.targetWeightKg),
    rirObjetivo: routineExercise.targetRir,
    descansoSeg: routineExercise.restSeconds,
    nota: routineExercise.note,
    ejercicio: routineExercise.exercise
      ? mapExerciseToResponse(routineExercise.exercise)
      : null,
  };
}

/**
 * `viewer` es opcional por compatibilidad con los llamadores antiguos: sin él
 * `esMia` y `puedoEditar` son false (no se puede saber sin conocer a quien mira).
 */
export function mapRoutineToResponse(
  routine: RoutineModel,
  viewer?: { id: string; canEdit: boolean },
): RoutineResponse {
  const flat = [...(routine.exercises ?? [])].sort((a, b) => a.order - b.order);
  const days = [...(routine.days ?? [])].sort((a, b) => a.order - b.order);
  return {
    id: routine.id,
    nombre: routine.name,
    descripcion: routine.description,
    creadoPorUsuarioId: routine.createdByUserId,
    visibilidad: routine.visibility,
    objetivo: routine.goal,
    estado: routine.status,
    ejercicios: flat.map(mapRoutineExerciseToResponse),
    dias: days.map((day) => ({
      id: day.id,
      diaSemana: day.weekday,
      nombre: day.name,
      orden: day.order,
      ejercicios: flat.filter((e) => e.routineDayId === day.id).map(mapRoutineExerciseToResponse),
    })),
    duracionSemanas: routine.durationWeeks,
    progresion: routine.progressionConfig ?? {},
    esOficial: routine.isOfficial,
    atribucion: routine.attribution,
    basadaEnRutinaId: routine.basedOnRoutineId,
    basadaEnVersion: routine.basedOnVersion,
    version: routine.version,
    huellaCorta: routine.fingerprint ? routine.fingerprint.slice(0, 8) : null,
    valoracion: {
      promedio: routine.ratingAverage == null ? null : Number(routine.ratingAverage),
      total: routine.ratingCount,
    },
    copias: routine.copiesCount,
    publicadaEn: routine.publishedAt,
    estadoModeracion: routine.moderationState,
    esMia: viewer ? viewer.id === routine.createdByUserId : false,
    puedoEditar: viewer?.canEdit ?? false,
    fechaCreacion: routine.createdAt,
    fechaActualizacion: routine.updatedAt,
  };
}

export function mapAssignmentToResponse(
  assignment: RoutineAssignmentModel,
): RoutineAssignmentResponse {
  return {
    id: assignment.id,
    rutinaId: assignment.routineId,
    clienteUsuarioId: assignment.clientUserId,
    asignadoPorUsuarioId: assignment.assignedByUserId,
    estado: assignment.status,
    fechaProgramada: assignment.scheduledFor,
    diasSemana: assignment.weekdays ?? [],
    repiteDesde: assignment.repeatsFrom,
    repiteHasta: assignment.repeatsUntil,
    nota: assignment.note,
    clienteNombre: assignment.client?.fullName ?? null,
    clienteEmail: assignment.client?.email ?? null,
    rutina: assignment.routine ? mapRoutineToResponse(assignment.routine) : null,
    fechaCreacion: assignment.createdAt,
  };
}
