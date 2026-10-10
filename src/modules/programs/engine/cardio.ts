/**
 * Motor de cardio (04_MOTOR §4): FC máxima, zonas de Karvonen, esfuerzo
 * percibido (Borg CR10), minutos que cuentan y progresión semanal (≤ 10 %).
 */
export type IntensityTarget =
  | { type: 'ZONA_FC'; zone: number }
  | { type: 'RPE'; rpe: number };

/** Tanaka: 208 − 0,7 × edad. */
export function maxHeartRate(age: number): number {
  return Math.round(208 - 0.7 * age);
}

const ZONE_PERCENT: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
];

/** Límites (lpm) de una zona 1–5. Con FC en reposo usa Karvonen; sin ella, % de la FC máxima. */
export function zoneBounds(zone: number, hrMax: number, hrRest?: number | null): { minBpm: number; maxBpm: number } {
  const [low, high] = ZONE_PERCENT[Math.min(Math.max(zone, 1), 5) - 1];
  if (hrRest != null && hrRest > 0 && hrRest < hrMax) {
    const reserve = hrMax - hrRest;
    return { minBpm: Math.round(hrRest + low * reserve), maxBpm: Math.round(hrRest + high * reserve) };
  }
  return { minBpm: Math.round(low * hrMax), maxBpm: Math.round(high * hrMax) };
}

/** Zona en la que cae una FC media (0 si está por debajo de la zona 1). */
export function zoneOfHeartRate(bpm: number, hrMax: number, hrRest?: number | null): number {
  let found = 0;
  for (let zone = 1; zone <= 5; zone += 1) {
    if (bpm >= zoneBounds(zone, hrMax, hrRest).minBpm) found = zone;
  }
  return found;
}

/** Borg CR10: 1–2 ≈ Z1, 3–4 ≈ Z2, 5–6 ≈ Z3, 7–8 ≈ Z4, 9–10 ≈ Z5. */
export function zoneOfRpe(rpe: number): number {
  if (rpe <= 2) return 1;
  return Math.min(Math.ceil(rpe / 2), 5);
}

export function targetZone(target: IntensityTarget): number {
  return target.type === 'ZONA_FC' ? target.zone : zoneOfRpe(target.rpe);
}

export type CardioSetInput = {
  durationSeconds: number;
  avgHeartRate?: number | null;
  rpe?: number | null;
};

/**
 * Minutos que cuentan para la semana. En o por encima de la zona objetivo
 * cuentan; por debajo, 0. A intensidad vigorosa (≥ Z4 o esfuerzo ≥ 7) cada
 * minuto vale 2 (equivalencia OMS: 150–300 moderada o 75–150 vigorosa).
 * Sin dato de intensidad se da el beneficio de la duda: cuenta como el objetivo.
 */
export function countedMinutes(
  set: CardioSetInput,
  target: IntensityTarget,
  hr: { max: number; rest?: number | null },
): number {
  const minutes = set.durationSeconds / 60;
  let achieved: number | null = null;
  if (set.avgHeartRate != null) achieved = zoneOfHeartRate(set.avgHeartRate, hr.max, hr.rest);
  else if (set.rpe != null) achieved = zoneOfRpe(set.rpe);
  if (achieved === null) {
    return Math.round(minutes * (targetZone(target) >= 4 ? 2 : 1) * 10) / 10;
  }
  if (achieved < targetZone(target)) return 0;
  const vigorous = achieved >= 4 || (set.rpe != null && set.rpe >= 7);
  return Math.round(minutes * (vigorous ? 2 : 1) * 10) / 10;
}

/** Minutos objetivo por sesión de la semana `week` (1-based): +pct por semana, tope 300, nunca > 10 %. */
export function targetMinutesForWeek(baseMinutes: number, progressionPct: number, week: number): number {
  const pct = Math.min(Math.max(progressionPct, 0), 10) / 100;
  const grown = baseMinutes * (1 + pct) ** Math.max(week - 1, 0);
  // Sin el redondeo, 100 × 1,1 = 110,00000000000001 subiría un minuto de más.
  return Math.min(Math.ceil(Math.round(grown * 1e6) / 1e6), 300);
}

/** Semana cumplida: minutos que cuentan ≥ minutos objetivo × sesiones planeadas. */
export function isCardioWeekFulfilled(input: {
  countedMinutes: number;
  targetMinutesPerSession: number;
  sessionsPlan: number;
}): boolean {
  if (input.sessionsPlan <= 0) return false;
  return input.countedMinutes >= input.targetMinutesPerSession * input.sessionsPlan;
}

export type ConcurrentAdvice = { order: 'WEIGHTS_FIRST' | 'ANY'; suggestModality: string | null; reason: string | null };

/** Orden pesas → cardio y menos impacto si el día de pesas es de tren inferior. */
export function concurrentAdvice(input: {
  sameDayWithWeights: boolean;
  lowerBodyDay: boolean;
  modality: string;
  minutes: number;
}): ConcurrentAdvice {
  if (!input.sameDayWithWeights) return { order: 'ANY', suggestModality: null, reason: null };
  if (input.lowerBodyDay && input.modality === 'CORRER' && input.minutes > 30) {
    return {
      order: 'WEIGHTS_FIRST',
      suggestModality: 'BICI',
      reason: 'Hoy entrenas pierna: mejor bici o elíptica para no interferir con tu fuerza.',
    };
  }
  return { order: 'WEIGHTS_FIRST', suggestModality: null, reason: 'Haz primero las pesas y después el cardio.' };
}
