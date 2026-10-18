/**
 * Retos de la semana (P2, PLAN_RUTINAS_REPP/12).
 *
 * Lo que le faltaba a la senda: algo que hacer *esta* semana. Las insignias son
 * metas lejanas («llega a cien sesiones»); un reto es una meta de siete días,
 * hecha a la medida de cada socio para que sea alcanzable y no genérica.
 *
 * Todo lo de aquí es puro —sin base de datos ni reloj— para que la selección y
 * la medición se puedan probar sin montar nada:
 *
 * - **Personalizada**: el objetivo sale de la media de las cuatro semanas
 *   anteriores. Quien entrena dos veces no recibe «entrena cinco veces», y
 *   quien entrena cinco no recibe «entrena una».
 * - **Determinista**: la misma persona y la misma semana dan siempre los mismos
 *   tres retos. Abrir la pantalla dos veces, o desde dos dispositivos a la vez,
 *   no puede sortearlos de nuevo.
 * - **Tres dificultades**, una de cada, en orden fácil → medio → difícil, sin
 *   repetir tipo: tres retos del mismo tipo no son tres retos.
 */

export type ChallengeKind =
  | "SESSIONS"
  | "VOLUME_KG"
  | "SETS"
  | "NEW_EXERCISE"
  | "PERSONAL_RECORD"
  | "EARLY_SESSION"
  | "CARDIO_MINUTES"
  | "MUSCLE_GROUPS"
  | "GEO_SESSIONS"
  | "WEEKEND_SESSION";

export type ChallengeDifficulty = "FACIL" | "MEDIO" | "DIFICIL";

export const CHALLENGE_DIFFICULTIES: readonly ChallengeDifficulty[] = ["FACIL", "MEDIO", "DIFICIL"];

/** Puntos por reto cumplido. El difícil vale casi el triple que el fácil: elegir el difícil tiene que compensar. */
export const CHALLENGE_POINTS: Readonly<Record<ChallengeDifficulty, number>> = {
  FACIL: 60,
  MEDIO: 100,
  DIFICIL: 160,
};

/** Bono por cumplir los tres: la «semana redonda». */
export const PERFECT_WEEK_BONUS = 150;

/** Semanas de historial con las que se calcula la media. */
export const CHALLENGE_HISTORY_WEEKS = 4;

/** Lo que una semana midió para cada tipo de reto. */
export type WeekMeasures = Readonly<Record<ChallengeKind, number>>;

export const EMPTY_WEEK: WeekMeasures = {
  SESSIONS: 0,
  VOLUME_KG: 0,
  SETS: 0,
  NEW_EXERCISE: 0,
  PERSONAL_RECORD: 0,
  EARLY_SESSION: 0,
  CARDIO_MINUTES: 0,
  MUSCLE_GROUPS: 0,
  GEO_SESSIONS: 0,
  WEEKEND_SESSION: 0,
};

export interface ChallengeSpec {
  /** Único dentro de la semana: el propio tipo, porque no se repiten. */
  readonly code: string;
  readonly kind: ChallengeKind;
  readonly difficulty: ChallengeDifficulty;
  readonly target: number;
  readonly pointsReward: number;
}

interface KindRule {
  /** Objetivo mínimo por dificultad: lo que recibe quien no tiene historial. */
  readonly floor: Readonly<Record<ChallengeDifficulty, number>>;
  /** Redondeo del objetivo: «12.000 kg» se lee mejor que «11.873 kg». */
  readonly step: number;
  readonly cap?: number;
  /**
   * Solo se propone si el historial lo justifica. «45 minutos de cardio» a
   * quien nunca ha hecho cardio, o «ficha en tu sede» a quien nunca activó la
   * ubicación, no es un reto: es una tarea ajena.
   */
  readonly needs?: (average: WeekMeasures) => boolean;
}

const RULES: Readonly<Record<ChallengeKind, KindRule>> = {
  SESSIONS: { floor: { FACIL: 1, MEDIO: 2, DIFICIL: 3 }, step: 1, cap: 7 },
  VOLUME_KG: { floor: { FACIL: 1000, MEDIO: 3000, DIFICIL: 6000 }, step: 500 },
  SETS: { floor: { FACIL: 10, MEDIO: 25, DIFICIL: 45 }, step: 5 },
  NEW_EXERCISE: { floor: { FACIL: 1, MEDIO: 1, DIFICIL: 2 }, step: 1, cap: 5 },
  PERSONAL_RECORD: {
    floor: { FACIL: 1, MEDIO: 1, DIFICIL: 2 },
    step: 1,
    cap: 5,
    // Sin series de fuerza recientes no hay marca que batir.
    needs: (average) => average.SETS > 0,
  },
  EARLY_SESSION: {
    floor: { FACIL: 1, MEDIO: 1, DIFICIL: 2 },
    step: 1,
    cap: 3,
    needs: (average) => average.EARLY_SESSION > 0,
  },
  CARDIO_MINUTES: {
    floor: { FACIL: 15, MEDIO: 45, DIFICIL: 90 },
    step: 5,
    needs: (average) => average.CARDIO_MINUTES > 0,
  },
  MUSCLE_GROUPS: { floor: { FACIL: 2, MEDIO: 3, DIFICIL: 5 }, step: 1, cap: 8 },
  GEO_SESSIONS: {
    floor: { FACIL: 1, MEDIO: 2, DIFICIL: 3 },
    step: 1,
    cap: 7,
    needs: (average) => average.GEO_SESSIONS > 0,
  },
  WEEKEND_SESSION: { floor: { FACIL: 1, MEDIO: 1, DIFICIL: 2 }, step: 1, cap: 2 },
};

/** Qué tipos caben en cada dificultad. El orden no importa: lo decide el sorteo. */
const POOLS: Readonly<Record<ChallengeDifficulty, readonly ChallengeKind[]>> = {
  FACIL: ["SESSIONS", "SETS", "WEEKEND_SESSION", "EARLY_SESSION", "GEO_SESSIONS", "NEW_EXERCISE"],
  MEDIO: ["VOLUME_KG", "MUSCLE_GROUPS", "NEW_EXERCISE", "CARDIO_MINUTES", "SETS", "SESSIONS"],
  DIFICIL: ["PERSONAL_RECORD", "VOLUME_KG", "SESSIONS", "MUSCLE_GROUPS", "CARDIO_MINUTES"],
};

/**
 * Cuánto se aparta el objetivo de la media: el fácil pide un poco menos de lo
 * habitual, el medio lo habitual y el difícil un cuarto más.
 */
const FACTOR: Readonly<Record<ChallengeDifficulty, number>> = { FACIL: 0.75, MEDIO: 1, DIFICIL: 1.25 };

/** Media por semana de las semanas dadas. Una semana sin entrenar cuenta como cero: es la frecuencia real. */
export function averageWeeks(weeks: readonly WeekMeasures[]): WeekMeasures {
  const divisor = Math.max(1, weeks.length);
  const average = { ...EMPTY_WEEK } as Record<ChallengeKind, number>;
  for (const kind of Object.keys(EMPTY_WEEK) as ChallengeKind[]) {
    average[kind] = weeks.reduce((sum, week) => sum + (week[kind] ?? 0), 0) / divisor;
  }
  return average;
}

export function challengeTarget(kind: ChallengeKind, difficulty: ChallengeDifficulty, average: number): number {
  const rule = RULES[kind];
  const personal = Math.round((average * FACTOR[difficulty]) / rule.step) * rule.step;
  const target = Math.max(rule.floor[difficulty], personal);
  return rule.cap === undefined ? target : Math.min(rule.cap, target);
}

/**
 * Los tres retos de una semana para una persona.
 *
 * `history` son las semanas anteriores (hasta cuatro). La semilla es
 * `usuario:lunes`, así que la elección es estable dentro de la semana y cambia
 * de una a otra.
 */
export function generateWeeklyChallenges(input: {
  userId: string;
  weekStart: string;
  history: readonly WeekMeasures[];
}): ChallengeSpec[] {
  const average = averageWeeks(input.history);
  const random = seededRandom(`${input.userId}:${input.weekStart}`);
  const chosen = new Set<ChallengeKind>();
  return CHALLENGE_DIFFICULTIES.map((difficulty) => {
    const eligible = POOLS[difficulty].filter(
      (kind) => !chosen.has(kind) && (RULES[kind].needs?.(average) ?? true),
    );
    // Los pools de siempre (sesiones, series, volumen) garantizan que nunca se
    // vacía; la reserva existe solo para que el tipo no dependa de ello.
    const candidates = eligible.length > 0 ? eligible : FALLBACK.filter((kind) => !chosen.has(kind));
    const kind = candidates[Math.floor(random() * candidates.length)];
    chosen.add(kind);
    return {
      code: kind,
      kind,
      difficulty,
      target: challengeTarget(kind, difficulty, average[kind]),
      pointsReward: CHALLENGE_POINTS[difficulty],
    };
  });
}

const FALLBACK: readonly ChallengeKind[] = ["SESSIONS", "SETS", "VOLUME_KG", "MUSCLE_GROUPS"];

/** FNV-1a + mulberry32: pequeño, sin dependencias y estable entre máquinas. */
function seededRandom(seedText: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────── vistas

export interface ChallengeView {
  code: string;
  kind: ChallengeKind;
  difficulty: ChallengeDifficulty;
  title: string;
  description: string;
  icon: string;
  target: number;
  /** Acotado al objetivo: pasarse no da una barra al 140 %. */
  current: number;
  progress: number;
  progressLabel: string;
  pointsReward: number;
  completed: boolean;
  completedAt: string | null;
  /** Cumplido y todavía sin celebrar. */
  isNew: boolean;
}

export interface WeeklyChallengesView {
  weekStart: string;
  endsAt: string;
  items: ChallengeView[];
  completedCount: number;
  perfect: boolean;
  perfectBonus: number;
  perfectIsNew: boolean;
}

/** Estado guardado de un reto, tal como lo devuelve el repositorio. */
export interface StoredChallenge extends ChallengeSpec {
  readonly completedAt: Date | null;
  readonly seen: boolean;
}

export function toChallengeView(challenge: StoredChallenge, measured: number): ChallengeView {
  // Lo cumplido se queda cumplido aunque la medición baje (una sesión borrada):
  // los puntos de un reto no se devuelven, igual que los de una insignia.
  const completed = challenge.completedAt !== null || measured >= challenge.target;
  const current = completed ? challenge.target : Math.min(challenge.target, Math.floor(measured));
  const text = CHALLENGE_TEXT[challenge.kind];
  return {
    code: challenge.code,
    kind: challenge.kind,
    difficulty: challenge.difficulty,
    title: text.title(challenge.target),
    description: text.description,
    icon: text.icon,
    target: challenge.target,
    current,
    progress: challenge.target <= 0 ? 1 : Math.min(1, current / challenge.target),
    progressLabel: `${text.unit(current)} / ${text.unit(challenge.target)}`,
    pointsReward: challenge.pointsReward,
    completed,
    completedAt: challenge.completedAt?.toISOString() ?? (completed ? new Date().toISOString() : null),
    isNew: completed && !challenge.seen,
  };
}

export function toWeeklyView(input: {
  weekStart: string;
  endsAt: string;
  items: readonly ChallengeView[];
}): WeeklyChallengesView {
  const order = (view: ChallengeView) => CHALLENGE_DIFFICULTIES.indexOf(view.difficulty);
  const items = [...input.items].sort((left, right) => order(left) - order(right));
  const completedCount = items.filter((item) => item.completed).length;
  const perfect = items.length === CHALLENGE_DIFFICULTIES.length && completedCount === items.length;
  return {
    weekStart: input.weekStart,
    endsAt: input.endsAt,
    items,
    completedCount,
    perfect,
    perfectBonus: PERFECT_WEEK_BONUS,
    // La semana redonda es nueva mientras quede algún reto de esa semana sin
    // celebrar: el último en cumplirse es justo el que la redondeó.
    perfectIsNew: perfect && items.some((item) => item.isNew),
  };
}

/**
 * Miles con punto siempre («8.400»). `toLocaleString("es-ES")` no agrupa los
 * números de cuatro cifras, y «8400 kg / 12.000 kg» se lee como dos formatos.
 */
const formatNumber = (value: number): string =>
  String(Math.floor(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

const CHALLENGE_TEXT: Readonly<
  Record<ChallengeKind, { title: (target: number) => string; description: string; icon: string; unit: (value: number) => string }>
> = {
  SESSIONS: {
    title: (n) => (n === 1 ? "Entrena una vez" : `Entrena ${n} veces`),
    description: "Cuenta cualquier sesión que termines esta semana.",
    icon: "calendar-outline",
    unit: formatNumber,
  },
  VOLUME_KG: {
    title: (n) => `Mueve ${formatNumber(n)} kg`,
    description: "Peso por repeticiones de tus series de fuerza, sumado.",
    icon: "barbell-outline",
    unit: (value) => `${formatNumber(value)} kg`,
  },
  SETS: {
    title: (n) => `Completa ${n} series`,
    description: "Series de fuerza de cualquier ejercicio.",
    icon: "layers-outline",
    unit: formatNumber,
  },
  NEW_EXERCISE: {
    title: (n) => (n === 1 ? "Prueba un ejercicio nuevo" : `Prueba ${n} ejercicios nuevos`),
    description: "Uno que nunca hayas registrado antes.",
    icon: "sparkles-outline",
    unit: formatNumber,
  },
  PERSONAL_RECORD: {
    title: (n) => (n === 1 ? "Bate una marca" : `Bate ${n} marcas`),
    description: "Levanta más peso que nunca en un ejercicio.",
    icon: "trophy-outline",
    unit: formatNumber,
  },
  EARLY_SESSION: {
    title: (n) => (n === 1 ? "Entrena antes de las 9" : `Entrena ${n} veces antes de las 9`),
    description: "Empieza la sesión antes de las 9:00.",
    icon: "sunny-outline",
    unit: formatNumber,
  },
  CARDIO_MINUTES: {
    title: (n) => `${formatNumber(n)} minutos de cardio`,
    description: "Suma los minutos de tus series de cardio.",
    icon: "heart-outline",
    unit: (value) => `${formatNumber(value)} min`,
  },
  MUSCLE_GROUPS: {
    title: (n) => `Trabaja ${n} grupos musculares`,
    description: "Grupos distintos como músculo principal del ejercicio.",
    icon: "body-outline",
    unit: formatNumber,
  },
  GEO_SESSIONS: {
    title: (n) => `Ficha ${n} ${plural(n, "vez", "veces")} en tu sede`,
    description: "Termina la sesión en el gimnasio con la ubicación activada.",
    icon: "location-outline",
    unit: formatNumber,
  },
  WEEKEND_SESSION: {
    title: (n) => (n === 1 ? "Entrena el fin de semana" : `Entrena ${n} veces el fin de semana`),
    description: "Sábado o domingo, el día que mejor te venga.",
    icon: "calendar-clear-outline",
    unit: formatNumber,
  },
};

// ─────────────────────────────────────────────────────────────── calendario

/** Lunes de la semana de una fecha `YYYY-MM-DD`. */
export function mondayOfDate(dateOnly: string): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function addDaysTo(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Instante (ISO) en que empieza un día en la zona del negocio. Se calcula con el
 * desfase real de esa zona en ese momento, así que respeta los cambios de hora.
 */
export function zonedMidnightIso(dateOnly: string, timeZone: string): string {
  const utcGuess = Date.parse(`${dateOnly}T00:00:00Z`);
  const offset = zoneOffsetMs(utcGuess, timeZone);
  const candidate = utcGuess - offset;
  // Segunda pasada: si el cambio de hora cae entre la conjetura y el resultado.
  return new Date(utcGuess - zoneOffsetMs(candidate, timeZone)).toISOString();
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}
