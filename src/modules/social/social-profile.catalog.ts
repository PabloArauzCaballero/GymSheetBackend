/**
 * Closed catalogs for the optional "Conocer" profile questions.
 *
 * Codes are stable API values (UPPER_SNAKE) and are what the database stores;
 * labels are the Spanish copy the clients render. Adding a code is backwards
 * compatible; renaming or removing one requires a data migration.
 */

export const INTEREST_CODES = [
  // Sports and training
  "RUNNING",
  "CYCLING",
  "CROSSFIT",
  "YOGA",
  "PILATES",
  "CALISTHENICS",
  "BOXING",
  "MARTIAL_ARTS",
  "FOOTBALL",
  "BASKETBALL",
  "VOLLEYBALL",
  "TENNIS",
  "PADEL",
  "HIKING",
  "SWIMMING",
  "POWERLIFTING",
  "BODYBUILDING",
  "WEIGHTLIFTING",
  "FUNCTIONAL_TRAINING",
  "DANCE",
  "CLIMBING",
  "SKATING",
  "SURFING",
  "TRIATHLON",
  "MOBILITY",
  // Hobbies
  "MUSIC",
  "COOKING",
  "TRAVEL",
  "GAMING",
  "READING",
  "MOVIES",
  "SERIES",
  "PHOTOGRAPHY",
  "PETS",
  "NUTRITION",
  "MEDITATION",
  "ART",
  "TECHNOLOGY",
  "NATURE",
  "VOLUNTEERING",
] as const;

export type InterestCode = (typeof INTEREST_CODES)[number];

const INTEREST_LABELS: Record<InterestCode, string> = {
  RUNNING: "Correr",
  CYCLING: "Ciclismo",
  CROSSFIT: "CrossFit",
  YOGA: "Yoga",
  PILATES: "Pilates",
  CALISTHENICS: "Calistenia",
  BOXING: "Boxeo",
  MARTIAL_ARTS: "Artes marciales",
  FOOTBALL: "Fútbol",
  BASKETBALL: "Básquet",
  VOLLEYBALL: "Vóley",
  TENNIS: "Tenis",
  PADEL: "Pádel",
  HIKING: "Senderismo",
  SWIMMING: "Natación",
  POWERLIFTING: "Powerlifting",
  BODYBUILDING: "Fisicoculturismo",
  WEIGHTLIFTING: "Halterofilia",
  FUNCTIONAL_TRAINING: "Entrenamiento funcional",
  DANCE: "Baile",
  CLIMBING: "Escalada",
  SKATING: "Patinaje",
  SURFING: "Surf",
  TRIATHLON: "Triatlón",
  MOBILITY: "Movilidad y estiramientos",
  MUSIC: "Música",
  COOKING: "Cocina",
  TRAVEL: "Viajes",
  GAMING: "Videojuegos",
  READING: "Lectura",
  MOVIES: "Cine",
  SERIES: "Series",
  PHOTOGRAPHY: "Fotografía",
  PETS: "Mascotas",
  NUTRITION: "Nutrición",
  MEDITATION: "Meditación",
  ART: "Arte",
  TECHNOLOGY: "Tecnología",
  NATURE: "Naturaleza",
  VOLUNTEERING: "Voluntariado",
};

export type InterestCatalogEntry = { code: InterestCode; label: string };

export const INTEREST_CATALOG: readonly InterestCatalogEntry[] =
  INTEREST_CODES.map((code) => ({ code, label: INTEREST_LABELS[code] }));

export const MAX_PROFILE_INTERESTS = 5;
export const MAX_PROFILE_BIO_LENGTH = 500;

/**
 * Sexual orientation is special-category data: optional, hidden by default,
 * never used to filter or rank, never logged and never sent to the recommender.
 */
export const ORIENTATION_CODES = [
  "HETEROSEXUAL",
  "GAY",
  "LESBIAN",
  "BISEXUAL",
  "ASEXUAL",
  "DEMISEXUAL",
  "PANSEXUAL",
  "QUEER",
  "QUESTIONING",
] as const;
export type OrientationCode = (typeof ORIENTATION_CODES)[number];

export const DRINKING_CODES = ["NEVER", "SOCIALLY", "OFTEN"] as const;
export type DrinkingCode = (typeof DRINKING_CODES)[number];

export const SMOKING_CODES = ["NEVER", "SOMETIMES", "OFTEN"] as const;
export type SmokingCode = (typeof SMOKING_CODES)[number];

export const PETS_CODES = ["NONE", "DOG", "CAT", "OTHER", "WANTS"] as const;
export type PetsCode = (typeof PETS_CODES)[number];
