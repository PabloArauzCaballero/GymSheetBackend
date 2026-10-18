/**
 * Cierre semanal y recompensas de modo (04_MOTOR §5, D8).
 * El multiplicador sube 0,2 por semana cumplida hasta 2,0; NUNCA resta puntos
 * ganados (el libro solo inserta).
 *
 * Caída suave y escudo (P4, 2026-10-18): antes, una semana fallida devolvía el
 * multiplicador a x1,0, y tras ocho semanas buenas una gripe lo borraba todo.
 * Eso enseña a abandonar. Ahora fallar baja dos escalones (−0,4) y, si el
 * programa tiene escudo, ni eso: el escudo se gasta y el multiplicador se
 * queda donde estaba (esa semana no hay bono, porque no se cumplió).
 */
export const MULTIPLIER_STEP = 0.2;
export const MULTIPLIER_MAX = 2;
export const MULTIPLIER_MIN = 1;
/** Lo que baja una semana fallida sin escudo: dos escalones. */
export const MULTIPLIER_SOFT_DROP = 0.4;
/** Semanas cumplidas seguidas que dan un escudo, y cuántos se pueden tener. */
export const SHIELD_STREAK_WEEKS = 4;
export const MAX_SHIELDS = 1;
export const COMPLETED_PROGRAM_THRESHOLD = 0.75;
export const BONUS_GOAL_REACHED = 300;
export const BONUS_PROGRAM_COMPLETED = 500;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function nextMultiplier(current: number, fulfilled: boolean, shield = false): number {
  if (fulfilled) return round2(Math.min(current + MULTIPLIER_STEP, MULTIPLIER_MAX));
  if (shield) return round2(current);
  return round2(Math.max(MULTIPLIER_MIN, current - MULTIPLIER_SOFT_DROP));
}

export type WeekShieldOutcome = {
  multiplier: number;
  /** Escudos que le quedan al programa tras el cierre (0..1). */
  shields: number;
  shieldUsed: boolean;
  shieldEarned: boolean;
};

/**
 * Cierre de una semana con escudo.
 *
 * `recentClosed` son las semanas ya cerradas ANTES de esta, de la más antigua a
 * la más reciente, solo con las que cuentan (`cumplida` no nula: una semana sin
 * plan ni se paga ni se penaliza, así que tampoco rompe ni alarga la serie). El
 * escudo se gana al cerrar una semana cumplida que deja las últimas cuatro
 * cumplidas; después de gastarlo hacen falta otras cuatro seguidas.
 */
export function closeWeekWithShield(input: {
  current: number;
  fulfilled: boolean;
  shields: number;
  recentClosed: readonly boolean[];
}): WeekShieldOutcome {
  const hasShield = input.shields > 0;
  if (!input.fulfilled) {
    return {
      multiplier: nextMultiplier(input.current, false, hasShield),
      shields: hasShield ? input.shields - 1 : 0,
      shieldUsed: hasShield,
      shieldEarned: false,
    };
  }
  const lastFour = [...input.recentClosed, true].slice(-SHIELD_STREAK_WEEKS);
  const earned =
    !hasShield && lastFour.length === SHIELD_STREAK_WEEKS && lastFour.every(Boolean);
  return {
    multiplier: nextMultiplier(input.current, true),
    shields: earned ? Math.min(MAX_SHIELDS, input.shields + 1) : input.shields,
    shieldUsed: false,
    shieldEarned: earned,
  };
}

/** Nombre de cada escalón del multiplicador: un x1,6 a secas no le dice nada a nadie. */
const MULTIPLIER_TIERS = [
  { min: 2, name: 'Leyenda' },
  { min: 1.8, name: 'Imparable' },
  { min: 1.6, name: 'En llamas' },
  { min: 1.4, name: 'Encendido' },
  { min: 1.2, name: 'En marcha' },
] as const;

export type MultiplierTier = 'Arrancando' | 'En marcha' | 'Encendido' | 'En llamas' | 'Imparable' | 'Leyenda';

export function multiplierTier(multiplier: number): MultiplierTier {
  // Medio céntimo de margen: el valor llega de un DECIMAL(3,2) ya redondeado.
  return MULTIPLIER_TIERS.find((tier) => multiplier + 0.005 >= tier.min)?.name ?? 'Arrancando';
}

/** «x1,6» con la coma decimal que se lee en la app. */
export function formatMultiplier(multiplier: number): string {
  return `x${multiplier.toFixed(1).replace('.', ',')}`;
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
