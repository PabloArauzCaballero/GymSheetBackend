import type { BadgeCategory, BadgeCriterionType, BadgeRarity, BadgeSeed } from "./progression-catalog";

/**
 * Tercera tanda de insignias (2026-10-18, «premios de verdad»).
 *
 * - **Rachas largas**: completan los hitos de racha con carta propia (3, 7, 14,
 *   30, 60, 100, 200 y 365 días). Con los comodines, llegar a 60 ya es posible
 *   para alguien que no es una máquina.
 * - **Retos**: cumplidos 1/10/50/150 y semanas redondas 4/12. Son las insignias
 *   del hábito semanal, la parte que antes no tenía nada que hacer *ya*.
 * - **Secretas nuevas**: recompensa variable. Premian momentos (volver tras
 *   una ausencia, entrenar el día de tu cumpleaños) que nadie persigue, y por
 *   eso sorprenden. «Volviste» celebra la vuelta sin mencionar la ausencia.
 * - **Modo**: el escudo usado (secreta: nadie debería buscar fallar una semana)
 *   y cuatro semanas en x2,0.
 */

const RARITY_COLOR: Record<BadgeRarity, string> = {
  COMUN: "#8a8f98",
  RARA: "#5aa9e6",
  EPICA: "#b388ff",
  LEGENDARIA: "#ffb020",
};

type Compact = readonly [
  code: string,
  name: string,
  description: string,
  flavorText: string,
  category: BadgeCategory,
  rarity: BadgeRarity,
  icon: string,
  criterionType: BadgeCriterionType,
  threshold: number,
  points: number,
  secret: boolean,
];

const rows: readonly Compact[] = [
  // ──────────────────────────────────────────────────────────── rachas largas
  ["RACHA_60", "Sesenta días", "Mantén una racha de 60 días.", "Dos meses sin soltar la cuerda. Ya no es disciplina: es quien eres.", "CONSTANCIA", "LEGENDARIA", "flame", "STREAK_DAYS", 60, 700, false],
  ["RACHA_200", "Doscientos días", "Mantén una racha de 200 días.", "Doscientos días. Las estaciones cambiaron; tú no.", "CONSTANCIA", "LEGENDARIA", "bonfire", "STREAK_DAYS", 200, 1200, false],
  ["RACHA_365", "Un año de fuego", "Mantén una racha de 365 días.", "Un año entero, día tras día. Esto ya no se explica: se enseña.", "CONSTANCIA", "LEGENDARIA", "bonfire", "STREAK_DAYS", 365, 2000, false],

  // ───────────────────────────────────────────────────────────────────── retos
  ["PRIMER_RETO", "Reto aceptado", "Cumple tu primer reto de la semana.", "El primero de muchos. Ya sabes cómo va esto.", "CONSTANCIA", "COMUN", "flag-outline", "CHALLENGES_COMPLETED", 1, 30, false],
  ["RETOS_10", "Diez retos", "Cumple 10 retos semanales.", "Diez veces dijiste «esta semana sí». Y fue que sí.", "CONSTANCIA", "RARA", "flag", "CHALLENGES_COMPLETED", 10, 120, false],
  ["RETOS_50", "Cazarretos", "Cumple 50 retos semanales.", "Cincuenta retos. Los lunes ya los esperas con ganas.", "CONSTANCIA", "EPICA", "flag", "CHALLENGES_COMPLETED", 50, 350, false],
  ["RETOS_150", "Sin reto que se resista", "Cumple 150 retos semanales.", "Ciento cincuenta. A estas alturas el reto eres tú.", "CONSTANCIA", "LEGENDARIA", "ribbon", "CHALLENGES_COMPLETED", 150, 900, false],
  ["SEMANAS_REDONDAS_4", "Cuatro semanas redondas", "Cumple los tres retos de la semana 4 veces.", "Tres de tres, cuatro veces. Eso no es suerte.", "CONSTANCIA", "RARA", "checkmark-circle-outline", "PERFECT_WEEKS", 4, 200, false],
  ["SEMANAS_REDONDAS_12", "Un trimestre redondo", "Cumple los tres retos de la semana 12 veces.", "Doce semanas redondas. Lo difícil ya te parece normal.", "CONSTANCIA", "EPICA", "checkmark-circle", "PERFECT_WEEKS", 12, 500, false],

  // ────────────────────────────────────────────────────────────────── secretas
  ["VOLVISTE", "Volviste", "Entrena después de dos semanas o más sin venir.", "Lo importante no es cuánto tardaste. Es que estás aquí.", "SECRETA", "RARA", "return-down-back-outline", "COMEBACK_SESSIONS", 1, 100, true],
  ["DOBLE_TURNO", "Doble turno", "Termina dos sesiones el mismo día.", "Mañana y tarde. Hay quien no va ni una.", "SECRETA", "RARA", "repeat-outline", "MAX_SESSIONS_IN_DAY", 2, 100, true],
  ["MARATON", "Maratón", "Entrena dos horas o más en una sola sesión.", "Dos horas dentro. Te dio tiempo a todo y a un poco más.", "SECRETA", "EPICA", "hourglass-outline", "LONGEST_SESSION_MINUTES", 120, 150, true],
  ["MEDIANOCHE", "Medianoche", "Empieza una sesión entre las 00:00 y las 04:00.", "La ciudad dormía. La barra no.", "SECRETA", "RARA", "moon", "MIDNIGHT_SESSIONS", 1, 100, true],
  ["ANO_NUEVO", "Año nuevo", "Entrena un 1 de enero.", "Mientras otros escribían propósitos, tú ya ibas por la segunda serie.", "SECRETA", "EPICA", "sparkles-outline", "NEW_YEAR_SESSIONS", 1, 150, true],
  ["FELIZ_CUMPLEANOS", "Feliz cumpleaños", "Entrena el día de tu cumpleaños.", "El mejor regalo te lo hiciste tú. Feliz cumpleaños.", "SECRETA", "EPICA", "gift-outline", "BIRTHDAY_SESSIONS", 1, 150, true],
  ["DIA_DE_RECORDS", "Día de récords", "Bate tu marca en 3 ejercicios en una misma sesión.", "Tres récords de golpe. Hoy el cuerpo estaba de tu parte.", "SECRETA", "EPICA", "trophy", "MAX_RECORDS_IN_SESSION", 3, 180, true],
  // La del escudo es secreta a propósito: nadie debería buscar fallar una semana.
  ["MODO_ESCUDO", "Escudo arriba", "Usa el escudo de un programa para conservar tu multiplicador.", "Una semana floja no borra las buenas. Para eso estaba el escudo.", "SECRETA", "RARA", "shield-outline", "MODE_SHIELDS_USED", 1, 120, true],

  // ────────────────────────────────────────────────────────────────────── modo
  ["MODO_LEYENDA_4", "Cuatro semanas de leyenda", "Cumple 4 semanas con el multiplicador en x2,0.", "Un mes entero en lo más alto. Leyenda no es un nombre: es una costumbre.", "MODO", "LEGENDARIA", "flash", "MODE_MAX_MULTIPLIER_WEEKS", 4, 700, false],
];

/** Detrás de la segunda tanda, que empieza en 600 y acaba antes de 1200. */
const FIRST_SORT_ORDER = 2000;

export const premiosBadgeSeeds: readonly BadgeSeed[] = rows.map(
  ([code, name, description, flavorText, category, rarity, icon, criterionType, threshold, points, secret], index) => ({
    code,
    audience: "ANY",
    name,
    description,
    flavorText,
    category,
    rarity,
    icon,
    color: RARITY_COLOR[rarity],
    criterionType,
    criterionThreshold: threshold,
    pointsReward: points,
    secret,
    sortOrder: FIRST_SORT_ORDER + index * 10,
  }),
);
