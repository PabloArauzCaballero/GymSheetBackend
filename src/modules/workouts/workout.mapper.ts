import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { mapExerciseToResponse, ExerciseResponse } from '../exercises/exercise.mapper';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { SkipReason, WorkoutSkippedSetModel } from './workout-skipped-set.model';

export type WorkoutSetResponse = {
  id: string;
  numeroSerie: number;
  tipoSerie: 'FUERZA' | 'CARDIO';
  /** Nulos en las series de cardio. */
  repeticiones: number | null;
  pesoKg: number | null;
  rir: number | null;
  duracionSeg: number | null;
  distanciaM: number | null;
  fcMedia: number | null;
  rpe: number | null;
  descansoSegAnterior: number;
  fechaRegistro: Date;
};

/** Serie que no se hizo (D1). No está en `series`: no cuenta para nada. */
export type WorkoutSkippedSetResponse = {
  id: string;
  numeroSerie: number;
  motivo: SkipReason;
  nota: string | null;
  fechaRegistro: Date;
};

export type WorkoutSessionExerciseResponse = {
  id: string;
  orden: number;
  esEnfasis: boolean;
  nota: string | null;
  /** Objetivo copiado de la rutina al empezar (C3.a); todo null si se añadió a mano. */
  seriesObjetivo: number | null;
  repsMin: number | null;
  repsMax: number | null;
  pesoObjetivoKg: number | null;
  rirObjetivo: number | null;
  descansoSeg: number | null;
  descansoEntreSeg: number | null;
  duracionSeg: number | null;
  grupo: number | null;
  grupoTipo: 'SUPERSERIE' | 'CIRCUITO' | null;
  ejercicio: ExerciseResponse | null;
  series: WorkoutSetResponse[];
  /** Series saltadas, por número. */
  saltadas: WorkoutSkippedSetResponse[];
  /** El ejercicio se omitió esta sesión; `null` si no. */
  omitido: { motivo: SkipReason; nota: string | null; fecha: Date } | null;
};

export type WorkoutSessionResponse = {
  id: string;
  usuarioId: string;
  fechaInicio: Date;
  fechaFin: Date | null;
  estado: WorkoutSessionStatus;
  observacion: string | null;
  geoVerificada: boolean;
  /** De dónde nació la sesión; todo `null` si fue libre. */
  rutinaId: string | null;
  rutinaDiaId: string | null;
  programaId: string | null;
  seriesSaltadas: number;
  ejerciciosOmitidos: number;
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
    tipoSerie: set.type ?? 'FUERZA',
    repeticiones: set.repetitions,
    pesoKg: set.weightKg == null ? null : Number(set.weightKg),
    rir: set.rir,
    duracionSeg: set.durationSeconds ?? null,
    distanciaM: set.distanceM ?? null,
    fcMedia: set.avgHeartRate ?? null,
    rpe: set.rpe ?? null,
    descansoSegAnterior: set.previousRestSeconds,
    fechaRegistro: set.recordedAt,
  };
}

export function mapSkippedSetToResponse(skipped: WorkoutSkippedSetModel): WorkoutSkippedSetResponse {
  return {
    id: skipped.id,
    numeroSerie: skipped.setNumber,
    motivo: skipped.reason,
    nota: skipped.note ?? null,
    fechaRegistro: skipped.recordedAt,
  };
}

export function mapSessionExerciseToResponse(
  sessionExercise: WorkoutSessionExerciseModel,
): WorkoutSessionExerciseResponse {
  return {
    id: sessionExercise.id,
    orden: sessionExercise.order,
    esEnfasis: sessionExercise.isEmphasis,
    nota: sessionExercise.note,
    seriesObjetivo: sessionExercise.targetSets ?? null,
    repsMin: sessionExercise.repsMin ?? null,
    repsMax: sessionExercise.repsMax ?? null,
    pesoObjetivoKg: sessionExercise.targetWeightKg == null ? null : Number(sessionExercise.targetWeightKg),
    rirObjetivo: sessionExercise.targetRir ?? null,
    descansoSeg: sessionExercise.restSeconds ?? null,
    descansoEntreSeg: sessionExercise.restBetweenSeconds ?? null,
    duracionSeg: sessionExercise.durationSeconds ?? null,
    grupo: sessionExercise.group ?? null,
    grupoTipo: sessionExercise.groupType ?? null,
    ejercicio: sessionExercise.exercise
      ? mapExerciseToResponse(sessionExercise.exercise)
      : null,
    series: (sessionExercise.sets ?? []).map(mapWorkoutSetToResponse),
    saltadas: [...(sessionExercise.skippedSets ?? [])]
      .sort((a, b) => a.setNumber - b.setNumber)
      .map(mapSkippedSetToResponse),
    omitido:
      sessionExercise.omittedReason && sessionExercise.omittedAt
        ? {
            motivo: sessionExercise.omittedReason,
            nota: sessionExercise.omittedNote ?? null,
            fecha: sessionExercise.omittedAt,
          }
        : null,
  };
}

export function mapWorkoutSessionToResponse(
  session: WorkoutSessionModel,
): WorkoutSessionResponse {
  return {
    id: session.id,
    usuarioId: session.userId,
    fechaInicio: session.startedAt,
    fechaFin: session.finishedAt,
    estado: session.status,
    observacion: session.observation,
    geoVerificada: session.geoVerified,
    rutinaId: session.routineId ?? null,
    rutinaDiaId: session.routineDayId ?? null,
    programaId: session.programId ?? null,
    seriesSaltadas: (session.sessionExercises ?? []).reduce(
      (total, exercise) => total + (exercise.skippedSets?.length ?? 0),
      0,
    ),
    ejerciciosOmitidos: (session.sessionExercises ?? []).filter(
      (exercise) => exercise.omittedReason != null,
    ).length,
    ejercicios: (session.sessionExercises ?? []).map(mapSessionExerciseToResponse),
  };
}
