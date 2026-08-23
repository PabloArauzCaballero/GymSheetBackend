/**
 * Catálogo sembrado de la senda: rangos e insignias.
 *
 * ─── Por qué está escrito así ────────────────────────────────────────────────
 *
 * Este archivo es la **semilla**, no la fuente de verdad. Lo que manda es la
 * tabla: un administrador puede renombrar un rango, mover un umbral o inventar
 * una insignia sin tocar el código. Sembrar es solo garantizar que un gimnasio
 * recién instalado no arranque con una pantalla vacía.
 *
 * ─── La narrativa ───────────────────────────────────────────────────────────
 *
 * La promesa del producto no es «registra tus series»: es *acercarte a la
 * imagen que tienes de ti mismo*. La senda hace visible esa distancia. Cuatro
 * decisiones sostienen que funcione:
 *
 * 1. **Los rangos nombran identidad, no tareas.** «GYM RAT» dice quién eres;
 *    «12 entrenamientos» dice qué hiciste. Lo primero se lleva puesto y se
 *    cuenta a un amigo; lo segundo se olvida. Por eso cada rango tiene un
 *    `tagline` en segunda persona y en presente.
 * 2. **El siguiente hito siempre se ve.** Un camino con la meta a la vista
 *    aprieta el paso cuando está cerca. Los rangos bloqueados no se ocultan: se
 *    muestran apagados, con su nombre legible y sus puntos exactos.
 * 3. **La primera victoria llega en días, no en meses.** El salto al segundo
 *    rango cuesta unas cuatro sesiones. Un primer premio lejano no engancha a
 *    nadie; lo que engancha es comprobar pronto que el sistema responde.
 * 4. **Nunca se culpa.** Perder una racha es un hecho, no un reproche. El texto
 *    de una racha rota invita a empezar otra hoy y no menciona el fallo.
 *
 * ─── El filtrado por género ─────────────────────────────────────────────────
 *
 * Un arquetipo motiva cuando uno se reconoce en él, y la imagen ideal de un
 * socio no es la de una socia. Hay tres ramas completas: `MALE`, `FEMALE` y
 * `ANY`. `ANY` no es un descarte ni un catálogo pobre: es la rama neutra, con
 * los mismos ocho rangos y la misma fuerza, para quien no quiera declarar nada.
 *
 * ─── Sobre los nombres ──────────────────────────────────────────────────────
 *
 * El encargo pedía referencias directas de cultura anime («nivel Goku»). Los
 * nombres sembrados evocan ese registro sin usar marcas registradas ajenas,
 * porque el catálogo viaja dentro de un producto que se vende a gimnasios. Como
 * los rangos son editables desde la API de administración, un gimnasio que
 * quiera llamar «Goku» a su séptimo rango lo hace con un PATCH y sin desplegar
 * nada.
 */

export type ProgressionAudience = "ANY" | "MALE" | "FEMALE";

export type BadgeCriterionType =
  | "SESSION_COUNT"
  | "STREAK_DAYS"
  | "WEEKLY_STREAK"
  | "TOTAL_VOLUME_KG"
  | "SINGLE_SESSION_VOLUME_KG"
  | "TOTAL_SETS"
  | "TOTAL_REPS"
  | "DISTINCT_MUSCLE_GROUPS"
  | "DISTINCT_EXERCISES"
  | "EARLY_SESSIONS"
  | "NIGHT_SESSIONS"
  | "WEEKEND_SESSIONS"
  | "PERSONAL_RECORDS";

export type BadgeCategory =
  | "CONSTANCIA"
  | "VOLUMEN"
  | "FUERZA"
  | "VARIEDAD"
  | "HITO"
  | "SECRETA";

export type BadgeRarity = "COMUN" | "RARA" | "EPICA" | "LEGENDARIA";

export interface LevelSeed {
  readonly code: string;
  readonly audience: ProgressionAudience;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly minPoints: number;
  readonly sortOrder: number;
  readonly icon: string;
  readonly color: string;
}

export interface BadgeSeed {
  readonly code: string;
  readonly audience: ProgressionAudience;
  readonly name: string;
  readonly description: string;
  readonly flavorText: string;
  readonly category: BadgeCategory;
  readonly rarity: BadgeRarity;
  readonly icon: string;
  readonly color: string;
  readonly criterionType: BadgeCriterionType;
  readonly criterionThreshold: number;
  readonly pointsReward: number;
  readonly secret: boolean;
  readonly sortOrder: number;
}

/**
 * Umbrales de la senda, compartidos por las tres ramas.
 *
 * La curva se calibró contra un socio real de tres sesiones por semana (unos
 * 150 puntos por sesión): el segundo rango cae sobre la primera semana y media,
 * el cuarto sobre el segundo mes y el octavo queda a un par de años. Se declara
 * una sola vez porque los tres catálogos deben premiar el mismo esfuerzo: si
 * una rama subiera más rápido que otra, el filtro por género dejaría de ser una
 * cuestión de identidad y pasaría a ser una ventaja.
 */
const LEVEL_THRESHOLDS = [0, 500, 1500, 4000, 9000, 18000, 32000, 55000] as const;

/** Rampa de color: de la ceniza inicial al blanco incandescente del final. */
const LEVEL_COLORS = [
  "#8a8f98",
  "#5aa9e6",
  "#3ddc97",
  "#c3f400",
  "#ffb020",
  "#ff6b35",
  "#e0308c",
  "#f5f0ff",
] as const;

const LEVEL_ICONS = [
  "footsteps-outline",
  "walk-outline",
  "barbell-outline",
  "flame-outline",
  "flash-outline",
  "shield-outline",
  "planet-outline",
  "sparkles-outline",
] as const;

type LevelCopy = {
  readonly code: string;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
};

function buildLevels(
  audience: ProgressionAudience,
  copy: readonly LevelCopy[],
): readonly LevelSeed[] {
  return copy.map((entry, index) => ({
    code: entry.code,
    audience,
    name: entry.name,
    tagline: entry.tagline,
    description: entry.description,
    minPoints: LEVEL_THRESHOLDS[index],
    sortOrder: index + 1,
    icon: LEVEL_ICONS[index],
    color: LEVEL_COLORS[index],
  }));
}

/**
 * Rama masculina. El registro es el de la sala de pesas y el del anime de
 * combate: bestia, máquina, titán, instinto. Escala de «nadie te conoce» a «el
 * cuerpo va solo».
 */
const maleLevels = buildLevels("MALE", [
  {
    code: "NOVATO",
    name: "Novato",
    tagline: "Primer día. Todos empezamos aquí.",
    description:
      "Acabas de entrar. Nadie nace sabiendo levantar; lo único que cuenta hoy es que apareciste.",
  },
  {
    code: "CONSTANTE",
    name: "Constante",
    tagline: "Ya no es un experimento. Es una rutina.",
    description:
      "Volviste cuando no te apetecía. Ese es el músculo que de verdad estás entrenando.",
  },
  {
    code: "GYM_RAT",
    name: "Gym Rat",
    tagline: "El gimnasio ya es tu segunda casa.",
    description:
      "Sabes a qué hora está libre la jaula y qué disco cojea. Ya eres de los de dentro.",
  },
  {
    code: "BESTIA",
    name: "Bestia",
    tagline: "Se nota cuando entras.",
    description:
      "El calentamiento de hoy era tu serie top de hace seis meses. Los números ya no son promesas.",
  },
  {
    code: "MAQUINA",
    name: "Máquina",
    tagline: "No fallas. No negocias. Ejecutas.",
    description:
      "Lluvia, examen, resaca, viaje. Da igual: el entrenamiento se hace. Eso ya no es fuerza, es carácter.",
  },
  {
    code: "TITAN",
    name: "Titán",
    tagline: "Ya no compites con nadie de la sala.",
    description:
      "El único rival que te queda es el que fuiste el mes pasado, y le llevas ventaja.",
  },
  {
    code: "SUPER_GUERRERO",
    name: "Super Guerrero",
    tagline: "Rompiste tu propio techo.",
    description:
      "Lo que creías tu límite resultó ser una parada intermedia. Aquí empieza lo que nadie te había contado.",
  },
  {
    code: "INSTINTO_PURO",
    name: "Instinto Puro",
    tagline: "El cuerpo ya sabe. Tú solo apareces.",
    description:
      "La técnica dejó de ser algo que piensas. Este rango no se alcanza entrenando duro: se alcanza entrenando años.",
  },
]);

/**
 * Rama femenina. Mismo esfuerzo, mismos umbrales, otro imaginario: la fuerza
 * como fiereza y soberanía, no como volumen. Evita deliberadamente el registro
 * de «tonificar» y «marcar», que es el que trata el entrenamiento femenino como
 * una versión menor del masculino.
 */
const femaleLevels = buildLevels("FEMALE", [
  {
    code: "NOVATA",
    name: "Novata",
    tagline: "Primer día. Todas empezamos aquí.",
    description:
      "Acabas de entrar. Nadie nace sabiendo levantar; lo único que cuenta hoy es que apareciste.",
  },
  {
    code: "CONSTANTE",
    name: "Constante",
    tagline: "Ya no es un experimento. Es una rutina.",
    description:
      "Volviste cuando no te apetecía. Ese es el músculo que de verdad estás entrenando.",
  },
  {
    code: "GYM_GIRL",
    name: "Gym Girl",
    tagline: "El gimnasio ya es tu segunda casa.",
    description:
      "Sabes a qué hora está libre el rack y qué disco cojea. Ya eres de las de dentro.",
  },
  {
    code: "FIERA",
    name: "Fiera",
    tagline: "Se nota cuando entras.",
    description:
      "El calentamiento de hoy era tu serie top de hace seis meses. Los números ya no son promesas.",
  },
  {
    code: "MAQUINA",
    name: "Máquina",
    tagline: "No fallas. No negocias. Ejecutas.",
    description:
      "Lluvia, examen, resaca, viaje. Da igual: el entrenamiento se hace. Eso ya no es fuerza, es carácter.",
  },
  {
    code: "VALQUIRIA",
    name: "Valquiria",
    tagline: "Ya no compites con nadie de la sala.",
    description:
      "La única rival que te queda es la que fuiste el mes pasado, y le llevas ventaja.",
  },
  {
    code: "AMAZONA",
    name: "Amazona",
    tagline: "Rompiste tu propio techo.",
    description:
      "Lo que creías tu límite resultó ser una parada intermedia. Aquí empieza lo que nadie te había contado.",
  },
  {
    code: "INSTINTO_PURO",
    name: "Instinto Puro",
    tagline: "El cuerpo ya sabe. Tú solo apareces.",
    description:
      "La técnica dejó de ser algo que piensas. Este rango no se alcanza entrenando duro: se alcanza entrenando años.",
  },
]);

/**
 * Rama neutra. Nombres sin género gramatical —objetos, materiales, estados— en
 * vez de dobletes con barra, que se leen como un formulario y no como un rango.
 */
const neutralLevels = buildLevels("ANY", [
  {
    code: "CHISPA",
    name: "Chispa",
    tagline: "Primer día. Todo empieza aquí.",
    description:
      "Acabas de entrar. Nadie nace sabiendo levantar; lo único que cuenta hoy es que apareciste.",
  },
  {
    code: "HABITO",
    name: "Hábito",
    tagline: "Ya no es un experimento. Es una rutina.",
    description:
      "Volviste cuando no te apetecía. Ese es el músculo que de verdad estás entrenando.",
  },
  {
    code: "GYM_RAT",
    name: "Gym Rat",
    tagline: "El gimnasio ya es tu segunda casa.",
    description:
      "Sabes a qué hora está libre el rack y qué disco cojea. Ya formas parte de dentro.",
  },
  {
    code: "FUERZA_BRUTA",
    name: "Fuerza Bruta",
    tagline: "Se nota cuando entras.",
    description:
      "El calentamiento de hoy era la serie top de hace seis meses. Los números ya no son promesas.",
  },
  {
    code: "MAQUINA",
    name: "Máquina",
    tagline: "No falla. No negocia. Ejecuta.",
    description:
      "Lluvia, examen, resaca, viaje. Da igual: el entrenamiento se hace. Eso ya no es fuerza, es carácter.",
  },
  {
    code: "TITANIO",
    name: "Titanio",
    tagline: "Ya no compites con nadie de la sala.",
    description:
      "El único rival que queda es quien fuiste el mes pasado, y le llevas ventaja.",
  },
  {
    code: "ELITE",
    name: "Élite",
    tagline: "Rompiste tu propio techo.",
    description:
      "Lo que parecía el límite resultó ser una parada intermedia. Aquí empieza lo que nadie te había contado.",
  },
  {
    code: "INSTINTO_PURO",
    name: "Instinto Puro",
    tagline: "El cuerpo ya sabe. Tú solo apareces.",
    description:
      "La técnica dejó de ser algo que se piensa. Este rango no se alcanza entrenando duro: se alcanza entrenando años.",
  },
]);

export const levelSeeds: readonly LevelSeed[] = [
  ...neutralLevels,
  ...maleLevels,
  ...femaleLevels,
];

/**
 * Insignias.
 *
 * Casi todas son `ANY`: un premio por levantar cien toneladas no cambia según
 * quién las levante, y duplicarlo por rama solo repartiría el catálogo sin
 * añadir nada. Solo se separan por género las que **nombran** al que las gana,
 * porque ahí el texto sí tiene que sonar a la persona.
 *
 * Las `secret: true` no se anuncian: aparecen ya conseguidas. Son la parte de
 * recompensa impredecible del sistema —la que hace que abrir la pantalla tenga
 * algo que descubrir incluso en una semana floja— y por eso premian
 * comportamientos que nadie perseguiría si supiera que dan puntos.
 */
export const badgeSeeds: readonly BadgeSeed[] = [
  // ───────────────────────────────────────────────────────────── CONSTANCIA
  {
    code: "PRIMERA_SESION",
    audience: "ANY",
    name: "El primer día",
    description: "Registra tu primer entrenamiento.",
    flavorText: "Lo más difícil ya está hecho: cruzar la puerta.",
    category: "HITO",
    rarity: "COMUN",
    icon: "footsteps-outline",
    color: "#8a8f98",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 1,
    pointsReward: 25,
    secret: false,
    sortOrder: 10,
  },
  {
    code: "DIEZ_SESIONES",
    audience: "ANY",
    name: "Diez veces",
    description: "Completa 10 entrenamientos.",
    flavorText: "Diez decisiones seguidas de aparecer. Eso ya no es suerte.",
    category: "HITO",
    rarity: "COMUN",
    icon: "checkmark-done-outline",
    color: "#5aa9e6",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 10,
    pointsReward: 50,
    secret: false,
    sortOrder: 20,
  },
  {
    code: "CINCUENTA_SESIONES",
    audience: "ANY",
    name: "Medio centenar",
    description: "Completa 50 entrenamientos.",
    flavorText: "Cincuenta sesiones son media vida de excusas rechazadas.",
    category: "HITO",
    rarity: "RARA",
    icon: "trophy-outline",
    color: "#3ddc97",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 50,
    pointsReward: 150,
    secret: false,
    sortOrder: 30,
  },
  {
    code: "CIEN_SESIONES",
    audience: "ANY",
    name: "Club de los cien",
    description: "Completa 100 entrenamientos.",
    flavorText: "Ya no entrenas para cambiar. Entrenas porque eres así.",
    category: "HITO",
    rarity: "EPICA",
    icon: "medal-outline",
    color: "#ffb020",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 100,
    pointsReward: 400,
    secret: false,
    sortOrder: 40,
  },
  {
    code: "RACHA_3",
    audience: "ANY",
    name: "Tres seguidos",
    description: "Entrena 3 días seguidos.",
    flavorText: "El tercer día es donde la mayoría se cae. Tú no.",
    category: "CONSTANCIA",
    rarity: "COMUN",
    icon: "flame-outline",
    color: "#ff6b35",
    criterionType: "STREAK_DAYS",
    criterionThreshold: 3,
    pointsReward: 40,
    secret: false,
    sortOrder: 50,
  },
  {
    code: "RACHA_7",
    audience: "ANY",
    name: "Semana perfecta",
    description: "Entrena 7 días seguidos.",
    flavorText: "Siete de siete. El cuerpo protesta, la cabeza manda.",
    category: "CONSTANCIA",
    rarity: "RARA",
    icon: "flame",
    color: "#ff6b35",
    criterionType: "STREAK_DAYS",
    criterionThreshold: 7,
    pointsReward: 120,
    secret: false,
    sortOrder: 60,
  },
  {
    code: "RACHA_30",
    audience: "ANY",
    name: "Treinta días de fuego",
    description: "Entrena 30 días seguidos.",
    flavorText: "Un mes sin un solo hueco. Esto ya se cuenta en las cenas.",
    category: "CONSTANCIA",
    rarity: "LEGENDARIA",
    icon: "bonfire-outline",
    color: "#e0308c",
    criterionType: "STREAK_DAYS",
    criterionThreshold: 30,
    pointsReward: 600,
    secret: false,
    sortOrder: 70,
  },
  {
    code: "SEMANAS_4",
    audience: "ANY",
    name: "Un mes sin faltar",
    description: "Entrena al menos una vez por semana durante 4 semanas seguidas.",
    flavorText: "No hace falta ir todos los días. Hace falta no desaparecer.",
    category: "CONSTANCIA",
    rarity: "COMUN",
    icon: "calendar-outline",
    color: "#5aa9e6",
    criterionType: "WEEKLY_STREAK",
    criterionThreshold: 4,
    pointsReward: 80,
    secret: false,
    sortOrder: 80,
  },
  {
    code: "SEMANAS_12",
    audience: "ANY",
    name: "Un trimestre entero",
    description: "Entrena al menos una vez por semana durante 12 semanas seguidas.",
    flavorText: "Tres meses. Aquí es donde el espejo empieza a estar de acuerdo contigo.",
    category: "CONSTANCIA",
    rarity: "EPICA",
    icon: "calendar-number-outline",
    color: "#ffb020",
    criterionType: "WEEKLY_STREAK",
    criterionThreshold: 12,
    pointsReward: 350,
    secret: false,
    sortOrder: 90,
  },

  // ─────────────────────────────────────────────────────────────── VOLUMEN
  {
    code: "TONELADA",
    audience: "ANY",
    name: "Una tonelada",
    description: "Acumula 1.000 kg de volumen levantado.",
    flavorText: "Mil kilos movidos por ti. La primera de muchas.",
    category: "VOLUMEN",
    rarity: "COMUN",
    icon: "barbell-outline",
    color: "#8a8f98",
    criterionType: "TOTAL_VOLUME_KG",
    criterionThreshold: 1000,
    pointsReward: 30,
    secret: false,
    sortOrder: 100,
  },
  {
    code: "DIEZ_TONELADAS",
    audience: "ANY",
    name: "Diez toneladas",
    description: "Acumula 10.000 kg de volumen levantado.",
    flavorText: "Diez toneladas: un autobús urbano, disco a disco.",
    category: "VOLUMEN",
    rarity: "COMUN",
    icon: "barbell",
    color: "#5aa9e6",
    criterionType: "TOTAL_VOLUME_KG",
    criterionThreshold: 10000,
    pointsReward: 80,
    secret: false,
    sortOrder: 110,
  },
  {
    code: "CIEN_TONELADAS",
    audience: "ANY",
    name: "Cien toneladas",
    description: "Acumula 100.000 kg de volumen levantado.",
    flavorText: "Cien toneladas. Una locomotora, y la moviste en series de diez.",
    category: "VOLUMEN",
    rarity: "EPICA",
    icon: "train-outline",
    color: "#ffb020",
    criterionType: "TOTAL_VOLUME_KG",
    criterionThreshold: 100000,
    pointsReward: 400,
    secret: false,
    sortOrder: 120,
  },
  {
    code: "MIL_TONELADAS",
    audience: "ANY",
    name: "Mil toneladas",
    description: "Acumula 1.000.000 kg de volumen levantado.",
    flavorText: "Un millón de kilos. Ya no hay comparación que te haga justicia.",
    category: "VOLUMEN",
    rarity: "LEGENDARIA",
    icon: "planet-outline",
    color: "#f5f0ff",
    criterionType: "TOTAL_VOLUME_KG",
    criterionThreshold: 1000000,
    pointsReward: 1200,
    secret: false,
    sortOrder: 130,
  },
  {
    code: "SESION_BRUTAL",
    audience: "ANY",
    name: "Sesión brutal",
    description: "Levanta 10.000 kg en un solo entrenamiento.",
    flavorText: "Diez toneladas en una tarde. Hoy no había techo.",
    category: "VOLUMEN",
    rarity: "RARA",
    icon: "flash-outline",
    color: "#ff6b35",
    criterionType: "SINGLE_SESSION_VOLUME_KG",
    criterionThreshold: 10000,
    pointsReward: 150,
    secret: false,
    sortOrder: 140,
  },
  {
    code: "MIL_SERIES",
    audience: "ANY",
    name: "Mil series",
    description: "Registra 1.000 series.",
    flavorText: "Mil series. Nadie llega aquí de casualidad.",
    category: "VOLUMEN",
    rarity: "RARA",
    icon: "layers-outline",
    color: "#3ddc97",
    criterionType: "TOTAL_SETS",
    criterionThreshold: 1000,
    pointsReward: 200,
    secret: false,
    sortOrder: 150,
  },
  {
    code: "DIEZ_MIL_REPS",
    audience: "ANY",
    name: "Diez mil repeticiones",
    description: "Acumula 10.000 repeticiones.",
    flavorText: "Diez mil repeticiones. El oficio se construye así, de una en una.",
    category: "VOLUMEN",
    rarity: "EPICA",
    icon: "repeat-outline",
    color: "#ffb020",
    criterionType: "TOTAL_REPS",
    criterionThreshold: 10000,
    pointsReward: 300,
    secret: false,
    sortOrder: 160,
  },

  // ─────────────────────────────────────────────────────────────── VARIEDAD
  {
    code: "CUERPO_COMPLETO",
    audience: "ANY",
    name: "Cuerpo completo",
    description: "Entrena 6 grupos musculares distintos.",
    flavorText: "Nada de saltarse la pierna. El cuerpo es uno solo.",
    category: "VARIEDAD",
    rarity: "COMUN",
    icon: "body-outline",
    color: "#3ddc97",
    criterionType: "DISTINCT_MUSCLE_GROUPS",
    criterionThreshold: 6,
    pointsReward: 60,
    secret: false,
    sortOrder: 170,
  },
  {
    code: "MAPA_ANATOMICO",
    audience: "ANY",
    name: "Mapa anatómico",
    description: "Entrena 9 grupos musculares distintos.",
    flavorText: "No queda un rincón del mapa sin pisar.",
    category: "VARIEDAD",
    rarity: "EPICA",
    icon: "map-outline",
    color: "#e0308c",
    criterionType: "DISTINCT_MUSCLE_GROUPS",
    criterionThreshold: 9,
    pointsReward: 250,
    secret: false,
    sortOrder: 180,
  },
  {
    code: "EXPLORADOR",
    audience: "ANY",
    name: "Explorador",
    description: "Prueba 25 ejercicios distintos.",
    flavorText: "Salir de los cinco de siempre también es entrenar.",
    category: "VARIEDAD",
    rarity: "COMUN",
    icon: "compass-outline",
    color: "#5aa9e6",
    criterionType: "DISTINCT_EXERCISES",
    criterionThreshold: 25,
    pointsReward: 70,
    secret: false,
    sortOrder: 190,
  },
  {
    code: "CATALOGO_VIVO",
    audience: "ANY",
    name: "Catálogo vivo",
    description: "Prueba 75 ejercicios distintos.",
    flavorText: "Setenta y cinco ejercicios. Ya podrías dar clases.",
    category: "VARIEDAD",
    rarity: "RARA",
    icon: "library-outline",
    color: "#ffb020",
    criterionType: "DISTINCT_EXERCISES",
    criterionThreshold: 75,
    pointsReward: 220,
    secret: false,
    sortOrder: 200,
  },

  // ───────────────────────────────────────────────────────────────── FUERZA
  {
    code: "PRIMER_RECORD",
    audience: "ANY",
    name: "Primer récord",
    description: "Bate tu marca personal en un ejercicio.",
    flavorText: "Un número que nunca habías tocado. Ya no vuelve atrás.",
    category: "FUERZA",
    rarity: "COMUN",
    icon: "trending-up-outline",
    color: "#3ddc97",
    criterionType: "PERSONAL_RECORDS",
    criterionThreshold: 1,
    pointsReward: 40,
    secret: false,
    sortOrder: 210,
  },
  {
    code: "DIEZ_RECORDS",
    audience: "ANY",
    name: "Cazador de récords",
    description: "Bate tu marca personal en 10 ejercicios distintos.",
    flavorText: "Diez techos rotos. Y ninguno era el último.",
    category: "FUERZA",
    rarity: "RARA",
    icon: "rocket-outline",
    color: "#ff6b35",
    criterionType: "PERSONAL_RECORDS",
    criterionThreshold: 10,
    pointsReward: 200,
    secret: false,
    sortOrder: 220,
  },

  // ─── Identidad: una sola insignia, tres formas de nombrarla ───────────────
  //
  // Las tres comparten `code` a propósito. Premian lo mismo —veinticinco
  // sesiones— y solo cambia cómo llaman a quien la gana; con códigos distintos,
  // un socio recibiría la suya *y* la neutra por el mismo logro, y el catálogo
  // pagaría dos veces por un solo esfuerzo. Compartiendo código, la resolución
  // por especificidad se queda con la de su rama y descarta la otra.
  {
    code: "IDENTIDAD_25",
    audience: "MALE",
    name: "Gym Rat confirmado",
    description: "Completa 25 entrenamientos.",
    flavorText: "Ya no vas al gimnasio. Perteneces al gimnasio.",
    category: "HITO",
    rarity: "RARA",
    icon: "home-outline",
    color: "#c3f400",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 25,
    pointsReward: 100,
    secret: false,
    sortOrder: 230,
  },
  {
    code: "IDENTIDAD_25",
    audience: "FEMALE",
    name: "Gym Girl confirmada",
    description: "Completa 25 entrenamientos.",
    flavorText: "Ya no vas al gimnasio. Perteneces al gimnasio.",
    category: "HITO",
    rarity: "RARA",
    icon: "home-outline",
    color: "#e0308c",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 25,
    pointsReward: 100,
    secret: false,
    sortOrder: 230,
  },
  {
    code: "IDENTIDAD_25",
    audience: "ANY",
    name: "De la casa",
    description: "Completa 25 entrenamientos.",
    flavorText: "Ya no vas al gimnasio. Formas parte del gimnasio.",
    category: "HITO",
    rarity: "RARA",
    icon: "home-outline",
    color: "#3ddc97",
    criterionType: "SESSION_COUNT",
    criterionThreshold: 25,
    pointsReward: 100,
    secret: false,
    sortOrder: 230,
  },

  // ──────────────────────────────────────────────────────────────── SECRETAS
  {
    code: "MADRUGADOR",
    audience: "ANY",
    name: "Antes que el sol",
    description: "Entrena 5 veces antes de las 7:00.",
    flavorText: "La ciudad dormía. Tú ya ibas por la tercera serie.",
    category: "SECRETA",
    rarity: "RARA",
    icon: "sunny-outline",
    color: "#ffb020",
    criterionType: "EARLY_SESSIONS",
    criterionThreshold: 5,
    pointsReward: 130,
    secret: true,
    sortOrder: 300,
  },
  {
    code: "NOCTURNO",
    audience: "ANY",
    name: "Turno de noche",
    description: "Entrena 5 veces después de las 21:00.",
    flavorText: "Última hora, sala vacía, todo para ti. Hay quien lo prefiere así.",
    category: "SECRETA",
    rarity: "RARA",
    icon: "moon-outline",
    color: "#5aa9e6",
    criterionType: "NIGHT_SESSIONS",
    criterionThreshold: 5,
    pointsReward: 130,
    secret: true,
    sortOrder: 310,
  },
  {
    code: "FIN_DE_SEMANA",
    audience: "ANY",
    name: "Sin fines de semana",
    description: "Entrena 10 veces en sábado o domingo.",
    flavorText: "El resto descansaba. Tú también, pero después.",
    category: "SECRETA",
    rarity: "EPICA",
    icon: "beer-outline",
    color: "#e0308c",
    criterionType: "WEEKEND_SESSIONS",
    criterionThreshold: 10,
    pointsReward: 180,
    secret: true,
    sortOrder: 320,
  },
];
