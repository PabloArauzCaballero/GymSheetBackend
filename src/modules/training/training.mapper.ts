import {
  RoutineAssignmentStatus,
  RoutineStatus,
  RoutineVisibility,
  TrainingGoal,
} from '../../common/enums/domain.enums';
import { ExerciseResponse, mapExerciseToResponse } from '../exercises/exercise.mapper';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';

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

export type RoutineResponse = {
  id: string;
  nombre: string;
  descripcion: string | null;
  creadoPorUsuarioId: string;
  visibilidad: RoutineVisibility;
  objetivo: TrainingGoal | null;
  estado: RoutineStatus;
  ejercicios: RoutineExerciseResponse[];
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

export function mapRoutineToResponse(routine: RoutineModel): RoutineResponse {
  return {
    id: routine.id,
    nombre: routine.name,
    descripcion: routine.description,
    creadoPorUsuarioId: routine.createdByUserId,
    visibilidad: routine.visibility,
    objetivo: routine.goal,
    estado: routine.status,
    ejercicios: (routine.exercises ?? []).map(mapRoutineExerciseToResponse),
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
