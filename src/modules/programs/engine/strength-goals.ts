import { roundToPlate } from './week-generation';

/** Estimación de 1RM de Epley: w × (1 + reps/30). Poco fiable por encima de 10 repeticiones. */
export function epley(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export const EPLEY_RELIABLE_MAX_REPS = 10;

export function isReliableEstimate(reps: number): boolean {
  return reps >= 1 && reps <= EPLEY_RELIABLE_MAX_REPS;
}

/** Mejor e1RM entre las series dadas (solo las fiables si hay alguna). */
export function bestE1rm(sets: ReadonlyArray<{ weightKg: number; reps: number }>): number | null {
  const reliable = sets.filter((s) => isReliableEstimate(s.reps) && s.weightKg > 0);
  const pool = reliable.length > 0 ? reliable : sets.filter((s) => s.weightKg > 0 && s.reps > 0);
  if (pool.length === 0) return null;
  return Math.max(...pool.map((s) => epley(s.weightKg, s.reps)));
}

export type GoalWeek = { percent: number; isDeload: boolean };

/**
 * Carga de la semana `week` (1-based) como % del e1RM: bloques de 4 semanas
 * 70 / 75 / 80 / descarga 65; cada bloque posterior arranca 7,5 puntos más
 * arriba (77,5 / 82,5 / 87,5), con tope en 95 %.
 */
export function goalWeek(week: number): GoalWeek {
  const index = Math.max(week, 1) - 1;
  const block = Math.floor(index / 4);
  const position = index % 4;
  if (position === 3) return { percent: 65, isDeload: true };
  const percent = Math.min(70 + position * 5 + block * 7.5, 95);
  return { percent, isDeload: false };
}

export function workingWeightForGoalWeek(week: number, e1rmKg: number, stepKg = 1.25): number {
  return roundToPlate((goalWeek(week).percent / 100) * e1rmKg, stepKg);
}

export function isGoalReached(e1rmKg: number | null, goalKg: number | null): boolean {
  return e1rmKg != null && goalKg != null && e1rmKg >= goalKg;
}

/** Meta realista a 12 semanas: +5 a +10 % (principiante hasta +15 %). Solo orienta, no bloquea. */
export function realisticGoalRange(e1rmKg: number, beginner: boolean): { minKg: number; maxKg: number } {
  return {
    minKg: roundToPlate(e1rmKg * 1.05, 1.25),
    maxKg: roundToPlate(e1rmKg * (beginner ? 1.15 : 1.1), 1.25),
  };
}
