import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { mapExerciseToResponse, ExerciseResponse } from '../exercises/exercise.mapper';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';

export type WorkoutSetResponse = {
  id: string;
  numeroSerie: number;
  repeticiones: number;
  pesoKg: number;
  rir: number | null;
  descansoSegAnterior: number;
  fechaRegistro: Date;
};

export type WorkoutSessionExerciseResponse = {
  id: string;
  orden: number;
  rutinaEjercicioId: string | null;
  seriesObjetivo: number | null;
  repsMin: number | null;
  repsMax: number | null;
  pesoObjetivoKg: number | null;
  rirObjetivo: number | null;
  descansoSeg: number | null;
  esEnfasis: boolean;
  nota: string | null;
  ejercicio: ExerciseResponse | null;
  series: WorkoutSetResponse[];
};

export type WorkoutSessionResponse = {
  id: string;
  rutinaId: string | null;
  usuarioId: string;
  fechaInicio: Date;
  fechaFin: Date | null;
  estado: WorkoutSessionStatus;
  observacion: string | null;
  geoVerificada: boolean;
  ejercicios: WorkoutSessionExerciseResponse[];
};

export type WorkoutSessionPageResponse = {
  items: WorkoutSessionResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function mapWorkoutSetToResponse(set: WorkoutSetModel): WorkoutSetResponse {
  return {
    id: set.id,
    numeroSerie: set.setNumber,
    repeticiones: set.repetitions,
    pesoKg: Number(set.weightKg),
    rir: set.rir,
    descansoSegAnterior: set.previousRestSeconds,
    fechaRegistro: set.recordedAt,
  };
}

export function mapSessionExerciseToResponse(
  sessionExercise: WorkoutSessionExerciseModel,
): WorkoutSessionExerciseResponse {
  return {
    id: sessionExercise.id,
    orden: sessionExercise.order,
    rutinaEjercicioId: sessionExercise.routineExerciseId ?? null,
    seriesObjetivo: sessionExercise.plannedSets ?? null,
    repsMin: sessionExercise.plannedRepsMin ?? null,
    repsMax: sessionExercise.plannedRepsMax ?? null,
    pesoObjetivoKg: sessionExercise.plannedWeightKg == null ? null : Number(sessionExercise.plannedWeightKg),
    rirObjetivo: sessionExercise.plannedRir ?? null,
    descansoSeg: sessionExercise.plannedRestSeconds ?? null,
    esEnfasis: sessionExercise.isEmphasis,
    nota: sessionExercise.note,
    ejercicio: sessionExercise.exercise
      ? mapExerciseToResponse(sessionExercise.exercise)
      : null,
    series: (sessionExercise.sets ?? []).map(mapWorkoutSetToResponse),
  };
}

export function mapWorkoutSessionToResponse(
  session: WorkoutSessionModel,
): WorkoutSessionResponse {
  return {
    id: session.id,
    rutinaId: session.routineId ?? null,
    usuarioId: session.userId,
    fechaInicio: session.startedAt,
    fechaFin: session.finishedAt,
    estado: session.status,
    observacion: session.observation,
    geoVerificada: session.geoVerified,
    ejercicios: (session.sessionExercises ?? []).map(mapSessionExerciseToResponse),
  };
}
