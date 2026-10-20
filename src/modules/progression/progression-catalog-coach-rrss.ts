import type { BadgeCategory, BadgeCriterionType, BadgeRarity, BadgeSeed } from "./progression-catalog";

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
  // ────────────────────────────────────────────────────────── RRSS EN EL GYM
  [
    "HABLAR_3_PERSONAS",
    "Rompehielos del gym",
    "Conecta o entrena con 3 compañeros en el gimnasio.",
    "El gym también es comunidad. Tres personas ya saben tu nombre.",
    "SOCIAL",
    "RARA",
    "people-outline",
    "GYM_SOCIAL_PARTNERS",
    3,
    100,
    false,
  ],
  [
    "COMUNIDAD_GYM_10",
    "Comunidad activa",
    "Conecta o entrena con 10 compañeros en el gimnasio.",
    "Diez compañeros de sala. Entrenar en manada se siente diferente.",
    "SOCIAL",
    "EPICA",
    "people",
    "GYM_SOCIAL_PARTNERS",
    10,
    250,
    false,
  ],

  // ───────────────────────────────────────────────────────── LOGROS DE COACH
  // Para el alumno / atleta:
  [
    "COACH_PRIMERA_SESION",
    "Bajo tutela",
    "Completa tu primera sesión con una rutina asignada por un Coach.",
    "Confiaste en la experiencia. La técnica empieza aquí.",
    "COACH",
    "COMUN",
    "school-outline",
    "COACH_SESSIONS",
    1,
    50,
    false,
  ],
  [
    "COACH_DIEZ_SESIONES",
    "Alumno constante",
    "Completa 10 sesiones con rutina guiada por tu Coach.",
    "Diez entrenos ejecutados al pie de la letra. Los resultados se construyen así.",
    "COACH",
    "RARA",
    "school",
    "COACH_SESSIONS",
    10,
    150,
    false,
  ],
  // Para el coach:
  [
    "COACH_TRES_ATLETAS",
    "Mentor del gimnasio",
    "Asigna rutinas activas a 3 atletas diferentes.",
    "Tres personas progresando con tu método.",
    "COACH",
    "RARA",
    "ribbon-outline",
    "COACH_CLIENTS",
    3,
    200,
    false,
  ],
  [
    "COACH_DIEZ_RECORDS",
    "Forjador de marcas",
    "Tus atletas han batido 10 récords personales bajo tu tutela.",
    "Su marca es tu logro. Diez techos rotos con tus planes.",
    "COACH",
    "LEGENDARIA",
    "trophy",
    "COACH_CLIENTS_PRS",
    10,
    400,
    false,
  ],
];

const FIRST_SORT_ORDER = 3000;

export const coachRrssBadgeSeeds: readonly BadgeSeed[] = rows.map(
  (
    [
      code,
      name,
      description,
      flavorText,
      category,
      rarity,
      icon,
      criterionType,
      threshold,
      points,
      secret,
    ],
    index,
  ) => ({
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
