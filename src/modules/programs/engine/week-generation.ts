/**
 * Semanas generadas de una rutina (04_MOTOR §1, D5): semana base + progresión +
 * descarga activa. Funciones puras: ninguna regla vive en los clientes.
 */
export type ProgressionConfig = {
  activa?: boolean;
  /** Cada cuántas semanas hay descarga (4–6) o null/ausente si no hay. */
  descargaCada?: number | null;
  volumenDescarga?: number;
  cargaDescarga?: number;
};

export type WeekOverride = {
  weekNumber: number;
  isDeload: boolean;
  volumeFactor: number;
  loadFactor: number;
  note?: string | null;
};

export type BaseExercise = {
  routineExerciseId: string;
  exerciseId: string;
  order: number;
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetWeightKg: number | null;
  // C3.a: lo que la pantalla del día y el entrenamiento guiado necesitan.
  restSeconds?: number | null;
  targetRir?: number | null;
  note?: string | null;
  group?: number | null;
  groupType?: 'SUPERSERIE' | 'CIRCUITO' | null;
  restBetweenSeconds?: number | null;
  durationSeconds?: number | null;
};

export type BaseDay = {
  dayId: string;
  weekday: number | null;
  name: string | null;
  exercises: readonly BaseExercise[];
};

export type GeneratedWeek = {
  numero: number;
  esDescarga: boolean;
  factorVolumen: number;
  factorCarga: number;
  nota: string | null;
  dias: Array<{
    diaId: string;
    diaSemana: number | null;
    nombre: string | null;
    ejercicios: Array<{
      routineExerciseId: string;
      ejercicioId: string;
      orden: number;
      series: number;
      repsMin: number | null;
      repsMax: number | null;
      pesoObjetivoKg: number | null;
      descansoSeg: number | null;
      rirObjetivo: number | null;
      nota: string | null;
      grupo: number | null;
      grupoTipo: 'SUPERSERIE' | 'CIRCUITO' | null;
      descansoEntreSeg: number | null;
      duracionSeg: number | null;
    }>;
  }>;
};

export const MAX_WEEKS = 52;
const DEFAULT_DELOAD_VOLUME = 0.5;
const DEFAULT_DELOAD_LOAD = 0.9;

export function roundToPlate(weightKg: number, stepKg = 1.25): number {
  return Math.round(weightKg / stepKg) * stepKg;
}

export function generateWeeks(input: {
  days: readonly BaseDay[];
  durationWeeks: number;
  progression?: ProgressionConfig | null;
  overrides?: readonly WeekOverride[];
}): GeneratedWeek[] {
  const total = Math.min(Math.max(Math.trunc(input.durationWeeks), 1), MAX_WEEKS);
  const config = input.progression ?? {};
  const every = config.descargaCada && config.descargaCada >= 2 ? config.descargaCada : null;
  const overrideByWeek = new Map((input.overrides ?? []).map((o) => [o.weekNumber, o]));
  const weeks: GeneratedWeek[] = [];

  for (let n = 1; n <= total; n += 1) {
    const override = overrideByWeek.get(n);
    // Una descarga solo existe si cabe: con menos semanas que el ciclo no hay.
    const scheduledDeload = Boolean(config.activa !== false && every && total >= every && n % every === 0);
    const isDeload = override?.isDeload ?? scheduledDeload;
    const volumeFactor = override?.volumeFactor ?? (isDeload ? config.volumenDescarga ?? DEFAULT_DELOAD_VOLUME : 1);
    const loadFactor = override?.loadFactor ?? (isDeload ? config.cargaDescarga ?? DEFAULT_DELOAD_LOAD : 1);

    weeks.push({
      numero: n,
      esDescarga: isDeload,
      factorVolumen: volumeFactor,
      factorCarga: loadFactor,
      nota: override?.note ?? null,
      dias: input.days.map((day) => ({
        diaId: day.dayId,
        diaSemana: day.weekday,
        nombre: day.name,
        ejercicios: day.exercises.map((e) => ({
          routineExerciseId: e.routineExerciseId,
          ejercicioId: e.exerciseId,
          orden: e.order,
          series: Math.max(1, Math.round(e.targetSets * volumeFactor)),
          repsMin: e.repsMin,
          repsMax: e.repsMax,
          pesoObjetivoKg:
            e.targetWeightKg == null ? null : roundToPlate(e.targetWeightKg * loadFactor),
          descansoSeg: e.restSeconds ?? null,
          rirObjetivo: e.targetRir ?? null,
          nota: e.note ?? null,
          grupo: e.group ?? null,
          grupoTipo: e.groupType ?? null,
          descansoEntreSeg: e.restBetweenSeconds ?? null,
          duracionSeg: e.durationSeconds ?? null,
        })),
      })),
    });
  }
  return weeks;
}
