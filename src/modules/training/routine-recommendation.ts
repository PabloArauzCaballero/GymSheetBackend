import { FitnessGoal, TrainingGoal } from '../../common/enums/domain.enums';

/**
 * Regla de «Para ti» (10_CORRECCIONES §C7, 10a «Regla de selección»).
 * Función pura: recibe el perfil y las plantillas oficiales (con su
 * `metadata`) y devuelve las elegidas con su motivo. Sin base de datos.
 */

export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type TrainingLocation = 'GYM' | 'HOME' | 'OUTDOORS' | 'MIXED';
export type TemplateLevelValue = 'PRINCIPIANTE' | 'INTERMEDIO' | 'AVANZADO' | 'TODOS';

export type RecommendationProfile = {
  /** Objetivo del onboarding (FitnessGoal) — da también el subobjetivo. */
  primaryGoal: FitnessGoal | null;
  /** Objetivo del perfil antropométrico, si no hay onboarding. */
  profileGoal: TrainingGoal | null;
  level: ExperienceLevel | null;
  weeklyFrequency: number | null;
  location: TrainingLocation | null;
  /** Texto libre del onboarding («Mancuernas», «Barra y discos»…) o códigos. */
  equipment: readonly string[];
};

export type RecommendationCandidate = {
  id: string;
  plantilla: string;
  objetivo: TrainingGoal | null;
  subobjetivo: string | null;
  nivel: TemplateLevelValue;
  lugar: readonly string[];
  equipo: readonly string[];
  dias: number;
  valoracion: number | null;
  copias: number;
  soloSiObjetivo: boolean;
};

export type Recommendation<C extends RecommendationCandidate = RecommendationCandidate> = {
  candidate: C;
  motivo: string;
};

export const DEFAULT_TEMPLATE_KEY = 'repp-salud-total-3-dias';
export const MIN_DAYS = 2;
export const MAX_DAYS = 6;
const DEFAULT_DAYS = 3;

/** Mismo mapa que `onboarding.service.ts` (legacyGoal). */
export const LEGACY_GOAL: Record<FitnessGoal, TrainingGoal> = {
  [FitnessGoal.GAIN_MUSCLE]: TrainingGoal.HYPERTROPHY,
  [FitnessGoal.LOSE_FAT]: TrainingGoal.FAT_LOSS,
  [FitnessGoal.IMPROVE_STRENGTH]: TrainingGoal.STRENGTH,
  [FitnessGoal.IMPROVE_ENDURANCE]: TrainingGoal.ENDURANCE,
  [FitnessGoal.MAINTAIN_FITNESS]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.GENERAL_HEALTH]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.SPORT_PERFORMANCE]: TrainingGoal.GENERAL_HEALTH,
};

const SUBGOAL: Partial<Record<FitnessGoal, string>> = {
  [FitnessGoal.MAINTAIN_FITNESS]: 'MANTENER',
  [FitnessGoal.SPORT_PERFORMANCE]: 'DEPORTE',
};

const GOAL_LABEL: Record<TrainingGoal, string> = {
  [TrainingGoal.HYPERTROPHY]: 'Para hipertrofia',
  [TrainingGoal.STRENGTH]: 'Para fuerza',
  [TrainingGoal.FAT_LOSS]: 'Para perder grasa',
  [TrainingGoal.ENDURANCE]: 'Para resistencia',
  [TrainingGoal.GENERAL_HEALTH]: 'Para tu salud',
  [TrainingGoal.REHABILITATION]: 'Para volver con calma',
};

/** Niveles de plantilla aceptados por nivel de la persona, en orden de preferencia. */
const LEVEL_PREFERENCE: Record<ExperienceLevel, readonly TemplateLevelValue[]> = {
  BEGINNER: ['PRINCIPIANTE', 'TODOS'],
  INTERMEDIATE: ['INTERMEDIO', 'PRINCIPIANTE', 'TODOS'],
  ADVANCED: ['AVANZADO', 'INTERMEDIO', 'PRINCIPIANTE', 'TODOS'],
};

/** Etiquetas del onboarding (`equipmentOptions`) → códigos de la plantilla. */
const EQUIPMENT_ALIASES: Record<string, string> = {
  mancuernas: 'MANCUERNAS',
  'barra y discos': 'BARRA',
  barra: 'BARRA',
  maquinas: 'MAQUINAS',
  bandas: 'BANDAS',
  poleas: 'POLEAS',
  banco: 'BANCO',
  'peso corporal': 'PESO_CORPORAL',
  kettlebell: 'KETTLEBELL',
  kettlebells: 'KETTLEBELL',
};

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, ' ');

export function normalizeEquipment(values: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    const key = fold(value);
    out.add(EQUIPMENT_ALIASES[key] ?? key.toUpperCase().replace(/ /gu, '_'));
  }
  return out;
}

export function clampDays(frequency: number | null): number {
  if (frequency == null || !Number.isFinite(frequency)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(frequency)));
}

export function resolveGoal(profile: RecommendationProfile): { goal: TrainingGoal; subgoal: string | null } | null {
  if (profile.primaryGoal) {
    return { goal: LEGACY_GOAL[profile.primaryGoal], subgoal: SUBGOAL[profile.primaryGoal] ?? null };
  }
  if (profile.profileGoal) return { goal: profile.profileGoal, subgoal: null };
  return null;
}

const hasNoData = (p: RecommendationProfile): boolean =>
  !p.primaryGoal && !p.profileGoal && !p.level && p.weeklyFrequency == null && !p.location;

/** Lugar y equipo: en casa (o al aire libre) la plantilla debe poder hacerse en casa y con lo que hay. */
function fitsPlace(candidate: RecommendationCandidate, profile: RecommendationProfile, owned: Set<string>): boolean {
  const location = profile.location ?? 'GYM';
  const atHome = location === 'HOME' || location === 'OUTDOORS';
  if (atHome && !candidate.lugar.includes('HOME')) return false;
  if (location === 'GYM' && !candidate.lugar.includes('GYM')) return false;
  // Equipo: en el gimnasio se da por hecho. Fuera de él, ⊆ lo declarado (+ peso corporal).
  // Sin equipo declarado no se filtra: «no lo dijo» no es «no tiene nada».
  const doneAtHome = atHome || (location === 'MIXED' && !candidate.lugar.includes('GYM'));
  if (!doneAtHome || owned.size === 0) return true;
  return candidate.equipo.every((item) => item === 'PESO_CORPORAL' || owned.has(item));
}

function placeLabel(candidate: RecommendationCandidate, profile: RecommendationProfile): string {
  const location = profile.location ?? 'GYM';
  if (location === 'HOME' || location === 'OUTDOORS') return 'en casa';
  if (!candidate.lugar.includes('GYM')) return 'en casa';
  if (location === 'MIXED' && candidate.lugar.includes('HOME')) return 'casa o gimnasio';
  return 'gimnasio';
}

export function motivoFor(candidate: RecommendationCandidate, profile: RecommendationProfile): string {
  const goal = candidate.objetivo ? GOAL_LABEL[candidate.objetivo] : 'Para empezar';
  return `${goal} · ${candidate.dias} ${candidate.dias === 1 ? 'día' : 'días'} · ${placeLabel(candidate, profile)}`;
}

/**
 * 1. Objetivo (onboarding → legacyGoal; MANTENER/DEPORTE como subobjetivo).
 * 2. Días = clamp(frecuencia, 2, 6): exacto primero; si no, menos días, nunca más.
 * 3. Nivel compatible (principiante solo principiante/todos; avanzado prefiere avanzado > intermedio).
 * 4. Lugar y equipo ⊆ lo disponible.
 * 5. Desempate: valoración y después copias.
 * Si faltan, se completa con plantillas de salud general compatibles; si no hay
 * nada, o no hay datos de la persona, la nº 17 «Salud total 3 días».
 */
export function recommendRoutines<C extends RecommendationCandidate>(
  profile: RecommendationProfile,
  candidates: readonly C[],
  limit = 3,
): Recommendation<C>[] {
  const fallback = candidates.find((c) => c.plantilla === DEFAULT_TEMPLATE_KEY);
  if (hasNoData(profile)) {
    return fallback ? [{ candidate: fallback, motivo: motivoFor(fallback, profile) }] : [];
  }

  const resolved = resolveGoal(profile) ?? { goal: TrainingGoal.GENERAL_HEALTH, subgoal: null };
  const days = clampDays(profile.weeklyFrequency);
  const levels = LEVEL_PREFERENCE[profile.level ?? 'BEGINNER'];
  const owned = normalizeEquipment(profile.equipment);

  const eligible = (c: C, goal: TrainingGoal): boolean =>
    c.objetivo === goal &&
    (!c.soloSiObjetivo || resolved.goal === goal) &&
    c.dias >= 1 &&
    c.dias <= days &&
    levels.includes(c.nivel) &&
    fitsPlace(c, profile, owned);

  // Afinidad de lugar: a igualdad, la plantilla pensada para donde entrena la persona.
  const home = profile.location === 'HOME' || profile.location === 'OUTDOORS';
  const affinity = (c: C): number => Number(c.lugar[0] === (home ? 'HOME' : 'GYM'));
  const rank = (a: C, b: C): number =>
    Number(b.dias === days) - Number(a.dias === days) ||
    b.dias - a.dias ||
    Number(b.subobjetivo != null && b.subobjetivo === resolved.subgoal) -
      Number(a.subobjetivo != null && a.subobjetivo === resolved.subgoal) ||
    affinity(b) - affinity(a) ||
    levels.indexOf(a.nivel) - levels.indexOf(b.nivel) ||
    (b.valoracion ?? 0) - (a.valoracion ?? 0) ||
    b.copias - a.copias ||
    a.plantilla.localeCompare(b.plantilla);

  const picked = candidates.filter((c) => eligible(c, resolved.goal)).sort(rank);
  // Rehabilitación no se completa con otras: solo «Vuelta suave» (con su aviso).
  if (picked.length < limit && resolved.goal !== TrainingGoal.REHABILITATION && resolved.goal !== TrainingGoal.GENERAL_HEALTH) {
    picked.push(...candidates.filter((c) => eligible(c, TrainingGoal.GENERAL_HEALTH)).sort(rank));
  }
  if (picked.length === 0 && fallback) picked.push(fallback);

  return picked.slice(0, limit).map((candidate) => ({ candidate, motivo: motivoFor(candidate, profile) }));
}
