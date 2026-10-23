import { SessionExerciseTargets } from './workouts.repository';
import { SkipReason } from './workout-skipped-set.model';

/**
 * Rutina libre y cambio de ejercicio: reglas puras, sin base de datos.
 *
 * - **Rutina libre**: quien entrena elige (o no) las zonas que quiere trabajar
 *   y el servidor propone una sesión editable. Sin zonas, cuerpo completo.
 * - **Cambio de ejercicio**: se cambia uno por un equivalente diciendo por qué
 *   (máquina ocupada, molestia…) y si es solo hoy o para siempre en la rutina.
 */

/** Zonas que se pueden elegir. `NECK` y `CARDIO` no arman una sesión de fuerza. */
export const FREE_WORKOUT_GROUPS = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'ARMS',
  'CORE',
  'LEGS',
  'GLUTES',
  'CALVES',
] as const;
export type FreeWorkoutGroup = (typeof FREE_WORKOUT_GROUPS)[number];

/** Sin zonas elegidas: cuerpo completo, de lo grande a lo pequeño. */
export const FULL_BODY: readonly FreeWorkoutGroup[] = ['LEGS', 'CHEST', 'BACK', 'SHOULDERS', 'ARMS', 'CORE'];

export const FREE_WORKOUT_DEFAULT_SIZE = 6;
export const FREE_WORKOUT_MIN_SIZE = 3;
export const FREE_WORKOUT_MAX_SIZE = 10;

/** Un ejercicio candidato de una zona, ya ordenado por preferencia. */
export type GroupCandidate = {
  exerciseId: string;
  group: FreeWorkoutGroup;
};

/**
 * Reparte `size` ejercicios entre las zonas, por turnos, en el orden en que se
 * eligieron: con Pecho y Brazos y 6 ejercicios salen 3 y 3, el primero de cada
 * zona antes que el segundo de ninguna. Nunca repite un ejercicio (uno que
 * trabaja dos zonas cuenta la primera vez que aparece). Si una zona se queda
 * sin candidatos, las demás llenan su hueco.
 */
export function planFreeWorkout(
  groups: readonly FreeWorkoutGroup[],
  candidates: ReadonlyMap<FreeWorkoutGroup, readonly string[]>,
  size: number,
): GroupCandidate[] {
  const order = groups.length > 0 ? [...new Set(groups)] : [...FULL_BODY];
  const lists = order.map((group) => ({ group, ids: candidates.get(group) ?? [] }));
  const rounds = Math.max(0, ...lists.map((list) => list.ids.length));
  const interleaved = Array.from({ length: rounds }, (_, round) =>
    lists
      .filter((list) => round < list.ids.length)
      .map((list) => ({ exerciseId: list.ids[round], group: list.group })),
  ).flat();
  return interleaved
    .filter((item, index) => interleaved.findIndex((other) => other.exerciseId === item.exerciseId) === index)
    .slice(0, size);
}

/**
 * Objetivo inicial de un ejercicio de la rutina libre: 3 series de 8–12 con 90 s
 * de descanso; el core y las pantorrillas, más repeticiones y menos descanso.
 * Es un punto de partida editable, no una prescripción.
 */
const TARGET_SETS = 3;
const TARGET_RIR = 2;
const STANDARD_REPS_MIN = 8;
const STANDARD_REPS_MAX = 12;
const STANDARD_REST_SECONDS = 90;
const LIGHT_REPS_MIN = 12;
const LIGHT_REPS_MAX = 15;
const LIGHT_REST_SECONDS = 60;
const STANDARD_TARGET = {
  sets: TARGET_SETS,
  repsMin: STANDARD_REPS_MIN,
  repsMax: STANDARD_REPS_MAX,
  rir: TARGET_RIR,
  restSeconds: STANDARD_REST_SECONDS,
} as const;
const LIGHT_TARGET = {
  sets: TARGET_SETS,
  repsMin: LIGHT_REPS_MIN,
  repsMax: LIGHT_REPS_MAX,
  rir: TARGET_RIR,
  restSeconds: LIGHT_REST_SECONDS,
} as const;
const LIGHT_GROUPS: ReadonlySet<FreeWorkoutGroup> = new Set(['CORE', 'CALVES']);

export function freeWorkoutTargets(group: FreeWorkoutGroup): SessionExerciseTargets {
  const target = LIGHT_GROUPS.has(group) ? LIGHT_TARGET : STANDARD_TARGET;
  return {
    targetSets: target.sets,
    repsMin: target.repsMin,
    repsMax: target.repsMax,
    targetWeightKg: null,
    targetRir: target.rir,
    restSeconds: target.restSeconds,
    restBetweenSeconds: null,
    durationSeconds: null,
    group: null,
    groupType: null,
  };
}

/** Por qué se cambia un ejercicio. Se guarda en el historial de cambios. */
export const SWAP_REASONS = [
  'MAQUINA_OCUPADA',
  'SIN_EQUIPO',
  'MOLESTIA',
  'MUY_DIFICIL',
  'MUY_FACIL',
  'PREFERENCIA',
  'CAMBIO_DE_PLAN',
] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];

/** Solo hoy, o también en la rutina de la que nació la sesión. */
export const SWAP_SCOPES = ['SESION', 'RUTINA'] as const;
export type SwapScope = (typeof SWAP_SCOPES)[number];

/**
 * Si el ejercicio ya tenía series hechas, esas series se quedan con él (son
 * historia) y el ejercicio se marca como omitido para el resto: este es el
 * motivo de omisión equivalente.
 */
const OMIT_REASON_BY_SWAP: Readonly<Record<SwapReason, SkipReason>> = {
  MAQUINA_OCUPADA: 'EQUIPO_OCUPADO',
  SIN_EQUIPO: 'EQUIPO_OCUPADO',
  MOLESTIA: 'DOLOR',
  MUY_DIFICIL: 'TECNICA',
  MUY_FACIL: 'OTRO',
  PREFERENCIA: 'OTRO',
  CAMBIO_DE_PLAN: 'OTRO',
};

export function omitReasonFor(reason: SwapReason): SkipReason {
  return OMIT_REASON_BY_SWAP[reason];
}

/** Con la máquina ocupada o sin equipo, lo útil es otro equipo, no otro agarre de la misma máquina. */
export function wantsDifferentEquipment(reason: SwapReason | undefined): boolean {
  return reason === 'MAQUINA_OCUPADA' || reason === 'SIN_EQUIPO';
}

export type AlternativeRow = {
  id: string;
  equipment: string | null;
  sharedPrimary: number;
  shared: number;
  recommended: number | null;
};

/**
 * Ordena los equivalentes según el motivo: siempre primero los que comparten
 * más músculos principales; si el problema es el equipo, los de otro equipo
 * suben por delante de los de la misma máquina (que no se descartan: puede
 * haber dos máquinas iguales).
 */
export function rankAlternatives(
  rows: readonly AlternativeRow[],
  currentEquipment: string | null,
  reason: SwapReason | undefined,
): AlternativeRow[] {
  const sameEquipment = (row: AlternativeRow) =>
    currentEquipment !== null &&
    row.equipment !== null &&
    row.equipment.trim().toLowerCase() === currentEquipment.trim().toLowerCase();
  const penalize = wantsDifferentEquipment(reason);
  return [...rows].sort((a, b) => {
    if (penalize) {
      const diff = Number(sameEquipment(a)) - Number(sameEquipment(b));
      if (diff !== 0) return diff;
    }
    return (
      b.sharedPrimary - a.sharedPrimary ||
      b.shared - a.shared ||
      (b.recommended ?? -1) - (a.recommended ?? -1) ||
      a.id.localeCompare(b.id)
    );
  });
}

/** Cuántas series le quedan al ejercicio nuevo cuando el viejo ya tenía algunas hechas. */
export function remainingSets(targetSets: number | null, done: number): number | null {
  if (targetSets === null) return null;
  return Math.max(1, targetSets - done);
}
