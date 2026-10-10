/**
 * Cierre semanal y recompensas de modo (04_MOTOR §5, D8).
 * El multiplicador sube 0,2 por semana cumplida hasta 2,0 y vuelve a 1,0 si no
 * se cumple; NUNCA resta puntos ganados (el libro solo inserta).
 */
export const MULTIPLIER_STEP = 0.2;
export const MULTIPLIER_MAX = 2;
export const COMPLETED_PROGRAM_THRESHOLD = 0.75;
export const BONUS_GOAL_REACHED = 300;
export const BONUS_PROGRAM_COMPLETED = 500;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function nextMultiplier(current: number, fulfilled: boolean): number {
  if (!fulfilled) return 1;
  return round2(Math.min(current + MULTIPLIER_STEP, MULTIPLIER_MAX));
}

/** Puntos extra de una semana cumplida: base × (multiplicador − 1), redondeado. */
export function weekBonus(basePoints: number, multiplier: number): number {
  return Math.max(Math.round(basePoints * (multiplier - 1)), 0);
}

export function isWeekFulfilled(input: {
  sessionsPlan: number;
  sessionsDone: number;
  /** Fracción de ejercicios objetivo con series válidas completas (0..1). */
  workRatio: number;
}): boolean {
  if (input.sessionsPlan <= 0) return false;
  return input.sessionsDone >= input.sessionsPlan && input.workRatio >= 0.8;
}

/** Un programa cuenta como completado si se cumplieron ≥ 75 % de sus semanas cerradas. */
export function isProgramCompleted(fulfilledWeeks: number, closedWeeks: number): boolean {
  return closedWeeks > 0 && fulfilledWeeks / closedWeeks >= COMPLETED_PROGRAM_THRESHOLD;
}

/** Una sesión cuenta para el modo si dura ≥ 10 min y tiene ≥ 3 series (fuerza). */
export function sessionQualifies(input: { durationMinutes: number; strengthSets: number }): boolean {
  return input.durationMinutes >= 10 && input.strengthSets >= 3;
}

/** Serie sospechosa: más de 3 × el e1RM conocido (no cuenta y queda en tracking). */
export function isSuspiciousSet(weightKg: number, knownE1rmKg: number | null): boolean {
  return knownE1rmKg != null && knownE1rmKg > 0 && weightKg > 3 * knownE1rmKg;
}
