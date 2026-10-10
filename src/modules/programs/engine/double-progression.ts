import { roundToPlate } from './week-generation';

/**
 * Doble progresión (04_MOTOR §2): primero se suman repeticiones dentro del
 * rango; al llegar al tope en todas las series, sube el peso. Dos sesiones
 * seguidas por debajo del mínimo bajan el peso un 5 % para volver a progresar.
 */
export type LiftState = {
  suggestedKg: number;
  incrementKg: number;
  repsMin: number;
  repsMax: number;
  rirTarget: number | null;
  consecutiveFails: number;
};

export type PerformedSet = { reps: number; weightKg: number; rir: number | null };

export type ProgressionAction = 'RAISE' | 'HOLD' | 'LOWER' | 'DELOAD_SKIP' | 'NO_DATA' | 'ADD_LOAD';

export type ProgressionOutcome = {
  suggestedKg: number;
  consecutiveFails: number;
  action: ProgressionAction;
  /** Texto breve para la persona; sugerido, nunca obligatorio. */
  message: string;
};

export type ProgressionOptions = { isDeload: boolean; stepKg?: number };

/** Series con carga razonable: se descartan calentamientos (< 80 % del peso sugerido). */
export function validSets(sets: readonly PerformedSet[], suggestedKg: number): PerformedSet[] {
  return sets.filter((s) => s.reps > 0 && (suggestedKg <= 0 || s.weightKg >= suggestedKg * 0.8));
}

const LOWER_BODY = [
  'pierna', 'piernas', 'cuadriceps', 'cuádriceps', 'gluteo', 'glúteo', 'gluteos', 'glúteos',
  'isquio', 'isquiotibial', 'femoral', 'gemelo', 'pantorrilla', 'aductor', 'abductor',
  'quad', 'glute', 'hamstring', 'calves', 'calf', 'legs', 'leg', 'upper legs', 'lower legs',
];

/** 5 kg para tren inferior, 2,5 kg para el resto y para lo desconocido. */
export function defaultIncrementKg(muscleGroup: string | null | undefined): number {
  const group = (muscleGroup ?? '').trim().toLowerCase();
  if (!group) return 2.5;
  return LOWER_BODY.some((keyword) => group.includes(keyword)) ? 5 : 2.5;
}

export function applyDoubleProgression(
  state: LiftState,
  sets: readonly PerformedSet[],
  options: ProgressionOptions,
): ProgressionOutcome {
  const step = options.stepKg ?? 1.25;
  const keep = { suggestedKg: state.suggestedKg, consecutiveFails: state.consecutiveFails };

  if (options.isDeload) {
    return { ...keep, action: 'DELOAD_SKIP', message: 'Semana de descarga: no cambiamos tu peso.' };
  }
  const valid = validSets(sets, state.suggestedKg);
  if (valid.length === 0) {
    return { ...keep, action: 'NO_DATA', message: 'Sin series válidas para este ejercicio.' };
  }

  const failed = valid.some((s) => s.reps < state.repsMin);
  const reachedTop =
    !failed &&
    valid.every(
      (s) =>
        s.reps >= state.repsMax &&
        (state.rirTarget == null || s.rir == null || s.rir >= state.rirTarget - 1),
    );

  if (reachedTop) {
    // Peso corporal (0 kg): la progresión suma repeticiones o lastre, no kilos.
    if (state.suggestedKg === 0) {
      return {
        suggestedKg: 0,
        consecutiveFails: 0,
        action: 'ADD_LOAD',
        message: 'Llegaste al tope: añade lastre cuando hagas todas las series.',
      };
    }
    const next = roundToPlate(state.suggestedKg + state.incrementKg, step);
    return { suggestedKg: next, consecutiveFails: 0, action: 'RAISE', message: `¡Sube a ${formatKg(next)}!` };
  }

  if (failed) {
    const fails = state.consecutiveFails + 1;
    if (fails >= 2 && state.suggestedKg > 0) {
      const lowered = roundToPlate(state.suggestedKg * 0.95, step);
      return {
        suggestedKg: lowered,
        consecutiveFails: 0,
        action: 'LOWER',
        message: `Bajamos un poco (${formatKg(lowered)}) para volver a progresar.`,
      };
    }
    return { suggestedKg: state.suggestedKg, consecutiveFails: fails, action: 'HOLD', message: 'Mantén el peso y busca más repeticiones.' };
  }

  return { suggestedKg: state.suggestedKg, consecutiveFails: 0, action: 'HOLD', message: 'Sigue sumando repeticiones con este peso.' };
}

export function formatKg(kg: number): string {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/0$/u, '')} kg`;
}
