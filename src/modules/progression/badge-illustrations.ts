import type { BadgeCriterionType, BadgeRarity } from "./progression-catalog";

/**
 * Ilustración grande de la carta de cada insignia.
 *
 * Es una clave estable que los clientes traducen a un dibujo; si reciben una
 * que no conocen, usan `icon`. Sale del criterio que mide la insignia (así una
 * insignia creada por un gimnasio también tiene dibujo) y unas pocas se afinan
 * por código cuando el criterio no dice lo bastante.
 */
const BY_CRITERION: Record<BadgeCriterionType, string> = {
  SESSION_COUNT: "calendar-check",
  STREAK_DAYS: "streak-flame",
  WEEKLY_STREAK: "week-chain",
  TOTAL_VOLUME_KG: "weight-plate",
  SINGLE_SESSION_VOLUME_KG: "mountain",
  TOTAL_SETS: "stack-sets",
  TOTAL_REPS: "reps-counter",
  DISTINCT_MUSCLE_GROUPS: "anatomy",
  DISTINCT_EXERCISES: "compass",
  EARLY_SESSIONS: "sunrise",
  NIGHT_SESSIONS: "moon",
  WEEKEND_SESSIONS: "weekend",
  PERSONAL_RECORDS: "trophy",
  OVERLOAD_WEEKS_STREAK: "trending-up",
  MODE_MULTIPLIER_MAX: "lightning",
  STRENGTH_GOAL_REACHED: "target",
  CARDIO_WEEKLY_MINUTES: "heart-pulse",
  TOTAL_TRAINING_MINUTES: "hourglass",
  MAX_SET_WEIGHT_KG: "barbell-heavy",
  TIMED_SECONDS_TOTAL: "plank",
  CARDIO_TOTAL_MINUTES: "heart-pulse",
  CARDIO_TOTAL_KM: "runner",
  MONDAY_SESSIONS: "calendar-week",
  DISTINCT_WEEKDAYS: "calendar-week",
  MAX_SESSIONS_IN_WEEK: "calendar-week",
  GEO_VERIFIED_SESSIONS: "map-pin",
  SUPERSET_SESSIONS: "lightning",
  ROUTINES_CREATED: "pencil",
  ROUTINES_PUBLISHED: "megaphone",
  ROUTINE_COPIES_RECEIVED: "download",
  COMMENTS_WRITTEN: "chat-bubble",
  RATINGS_GIVEN: "star",
  COMMENT_LIKES_RECEIVED: "heart",
};

const BY_CODE: Readonly<Record<string, string>> = {
  PRIMERA_SESION: "first-step",
  PRIMER_RECORD: "medal",
  MODO_CARDIO_150: "stopwatch",
  PRIMER_CARDIO: "runner",
  CIEN_DESCARGAS: "crown",
  RACHA_100: "crown",
  SEMANAS_52: "crown",
};

export function badgeIllustration(code: string, criterion: BadgeCriterionType): string {
  return BY_CODE[code] ?? BY_CRITERION[criterion] ?? "medal";
}

const RARITY_RANK: Record<BadgeRarity, number> = { COMUN: 1, RARA: 2, EPICA: 3, LEGENDARIA: 4 };

/** 1 común … 4 legendaria: para ordenar cartas y elegir material sin comparar textos. */
export function rarityRank(rarity: string): number {
  return RARITY_RANK[rarity as BadgeRarity] ?? 1;
}
