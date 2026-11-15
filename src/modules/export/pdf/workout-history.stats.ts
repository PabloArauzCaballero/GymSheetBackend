import { WorkoutSessionStatus } from '../../../common/enums/domain.enums';
import type { WorkoutSessionExerciseResponse, WorkoutSessionResponse, WorkoutSetResponse } from '../../workouts/workout.mapper';
import { zonedDayNumber } from './format';

/**
 * Cifras del informe de avance. Base única: las sesiones **finalizadas**; las
 * que siguen en curso o se cancelaron se cuentan aparte y solo aparecen en el
 * historial.
 */
export type WorkoutHistoryStats = {
  readonly finishedSessions: number;
  readonly otherSessions: number;
  readonly totalSets: number;
  readonly totalReps: number;
  readonly totalVolumeKg: number;
  readonly totalMinutes: number;
  readonly timedSessions: number;
  readonly longestWeekStreak: number;
  /** Primera y última sesión de cualquier estado: el período que cubre el informe. */
  readonly firstDate: Date | null;
  readonly lastDate: Date | null;
};

export type ExerciseProgress = {
  readonly name: string;
  readonly sessions: number;
  readonly sets: number;
  /** Serie con más carga (a igual carga, más repeticiones). */
  readonly bestSet: { readonly kg: number; readonly reps: number } | null;
  /** Sesiones en las que hubo carga; con menos de dos no hay variación que medir. */
  readonly loadedSessions: number;
  /** Carga máxima de la primera y de la última sesión con carga. */
  readonly firstTopKg: number | null;
  readonly lastTopKg: number | null;
};

export function exerciseName(entry: WorkoutSessionExerciseResponse): string {
  return entry.ejercicio?.nombreEs ?? entry.ejercicio?.nombre ?? 'Ejercicio sin nombre';
}

export function setVolumeKg(set: WorkoutSetResponse): number {
  return (set.pesoKg ?? 0) * (set.repeticiones ?? 0);
}

export function sessionMinutes(session: WorkoutSessionResponse): number | null {
  if (!session.fechaFin) return null;
  const minutes = (new Date(session.fechaFin).getTime() - new Date(session.fechaInicio).getTime()) / 60000;
  return minutes > 0 ? minutes : null;
}

export function finishedSessions(sessions: readonly WorkoutSessionResponse[]): WorkoutSessionResponse[] {
  return sessions.filter((s) => s.estado === WorkoutSessionStatus.COMPLETED);
}

/** Semanas (lunes a domingo, en la zona del negocio) seguidas con al menos una sesión. */
function longestWeekStreak(dates: readonly Date[], timeZone: string): number {
  // 1970-01-01 fue jueves: +3 días alinea las semanas al lunes.
  const weeks = [...new Set(dates.map((date) => Math.floor((zonedDayNumber(date, timeZone) + 3) / 7)))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  weeks.forEach((week, i) => {
    run = i > 0 && week === weeks[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

export function computeWorkoutHistoryStats(sessions: readonly WorkoutSessionResponse[], timeZone: string): WorkoutHistoryStats {
  const finished = finishedSessions(sessions);
  const sets = finished.flatMap((s) => s.ejercicios.flatMap((e) => e.series));
  const minutes = finished.map(sessionMinutes).filter((m): m is number => m !== null);
  const dates = sessions.map((s) => new Date(s.fechaInicio)).sort((a, b) => a.getTime() - b.getTime());

  return {
    finishedSessions: finished.length,
    otherSessions: sessions.length - finished.length,
    totalSets: sets.length,
    totalReps: sets.reduce((sum, set) => sum + (set.repeticiones ?? 0), 0),
    totalVolumeKg: sets.reduce((sum, set) => sum + setVolumeKg(set), 0),
    totalMinutes: minutes.reduce((sum, m) => sum + m, 0),
    timedSessions: minutes.length,
    longestWeekStreak: longestWeekStreak(finished.map((s) => new Date(s.fechaInicio)), timeZone),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

/** Variación de carga máxima, solo con dos sesiones con carga o más. */
export function loadDelta(progress: ExerciseProgress): number | null {
  if (progress.loadedSessions < 2 || progress.firstTopKg === null || progress.lastTopKg === null) return null;
  return progress.lastTopKg - progress.firstTopKg;
}

/** Avance por ejercicio en las sesiones finalizadas, del más practicado al menos. */
export function computeExerciseProgress(sessions: readonly WorkoutSessionResponse[]): ExerciseProgress[] {
  type Acc = { name: string; sessions: number; sets: number; best: ExerciseProgress['bestSet']; tops: number[] };
  const byExercise = new Map<string, Acc>();
  const chronological = finishedSessions(sessions).sort(
    (a, b) => new Date(a.fechaInicio).getTime() - new Date(b.fechaInicio).getTime(),
  );

  for (const session of chronological) {
    for (const entry of session.ejercicios) {
      if (entry.series.length === 0) continue;
      const key = entry.ejercicio?.id ?? exerciseName(entry);
      const acc = byExercise.get(key) ?? { name: exerciseName(entry), sessions: 0, sets: 0, best: null, tops: [] };
      acc.sessions += 1;
      acc.sets += entry.series.length;
      let top: number | null = null;
      for (const set of entry.series) {
        if (set.pesoKg == null || set.pesoKg <= 0) continue;
        const reps = set.repeticiones ?? 0;
        top = Math.max(top ?? 0, set.pesoKg);
        if (!acc.best || set.pesoKg > acc.best.kg || (set.pesoKg === acc.best.kg && reps > acc.best.reps)) {
          acc.best = { kg: set.pesoKg, reps };
        }
      }
      if (top !== null) acc.tops.push(top);
      byExercise.set(key, acc);
    }
  }

  return [...byExercise.values()]
    .map((acc) => ({
      name: acc.name,
      sessions: acc.sessions,
      sets: acc.sets,
      bestSet: acc.best,
      loadedSessions: acc.tops.length,
      firstTopKg: acc.tops[0] ?? null,
      lastTopKg: acc.tops[acc.tops.length - 1] ?? null,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.sets - a.sets || a.name.localeCompare(b.name, 'es'));
}
