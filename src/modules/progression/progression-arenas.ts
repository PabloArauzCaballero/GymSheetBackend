/**
 * El camino de arenas: los **lugares** del gimnasio por los que se sube.
 *
 * ─── Por qué es un catálogo aparte de los rangos ─────────────────────────────
 *
 * El rango dice quién eres («Bestia») y lo administra el gimnasio. La arena
 * dice dónde estás y qué te espera, y es más fina: dieciséis lugares para
 * ocho rangos, como el camino de trofeos de los juegos de arenas, donde entre
 * un ascenso y el siguiente siempre hay otra puerta cerca. Una arena nueva cada
 * pocas semanas es lo que mantiene el gradiente de meta vivo entre rangos que
 * a partir del cuarto tardan meses.
 *
 * Los umbrales de las arenas impares son **exactamente** los de los ocho
 * rangos sembrados (`LEVEL_THRESHOLDS`): subir de rango es siempre entrar en
 * una arena, y añadir arenas no mueve el rango ni los premios de nadie.
 *
 * ─── De dónde salen las fases y los hitos ───────────────────────────────────
 *
 * Calibrados contra un socio de tres sesiones por semana (unos 450 puntos):
 *
 * - **Principiante → novato → intermedio → avanzado → élite** es la escala que
 *   comparten los estándares de fuerza (meses 0–6, 6–18, 1–3 años, 3–5+). La
 *   mayoría de quien entrena con constancia llega a intermedio; élite es
 *   minoría, y así se nota en los umbrales.
 * - **66 días** es la mediana medida para que un hábito de salud se vuelva
 *   automático (Lally et al.; Kaushal y Rhodes 2015): cae en La Jaula.
 * - **Semana 19** es la mediana de abandono de principiantes en apps de
 *   entrenamiento: superarla es el hito de La Plataforma.
 * - **Discos por lado, el doble del peso corporal y el club de los 1000 lb**
 *   (450 kg entre sentadilla, banca y muerto; 500 lb en la versión femenina)
 *   son los números que se celebran en cualquier sala.
 *
 * Los hitos son orientativos: el sistema no los mide ni bloquean nada. Dicen
 * qué suele pasar en cada fase para que el camino se lea como un plan.
 */
import type { ProgressionAudience } from "./progression-catalog";

export interface ArenaSeed {
  readonly code: string;
  readonly name: string;
  /** Una línea: qué es este lugar para quien llega. */
  readonly tagline: string;
  readonly minPoints: number;
  readonly milestones: readonly string[];
  /** Hitos con cifras que cambian por rama; si falta, valen los de arriba. */
  readonly byAudience?: Partial<Record<ProgressionAudience, readonly string[]>>;
}

export const ARENAS: readonly ArenaSeed[] = [
  {
    code: "PUERTA",
    name: "La Puerta",
    tagline: "Lo más difícil ya está hecho: entrar.",
    minPoints: 0,
    milestones: [
      "Tu primer entrenamiento registrado",
      "Elegir tu horario fijo",
      "Volver una segunda vez",
    ],
  },
  {
    code: "VESTUARIO",
    name: "El Vestuario",
    tagline: "Ya tienes taquilla favorita.",
    minPoints: 250,
    milestones: [
      "Dos semanas seguidas apareciendo",
      "Tu bolsa de gimnasio siempre lista",
      "Saber qué toca hoy antes de llegar",
    ],
  },
  {
    code: "MAQUINAS",
    name: "Sala de Máquinas",
    tagline: "Donde se aprende el movimiento.",
    minPoints: 500,
    milestones: [
      "Los cuatro patrones: sentadilla, bisagra, empuje y tirón",
      "Tres entrenamientos en una misma semana",
      "Sobrevivir a las primeras agujetas",
    ],
  },
  {
    code: "CARDIO",
    name: "Zona de Cardio",
    tagline: "El motor también se entrena.",
    minPoints: 900,
    milestones: [
      "20 minutos seguidos sin parar",
      "Calentar siempre antes de las pesas",
      "Tu primera semana con cardio y fuerza",
    ],
  },
  {
    code: "MANCUERNAS",
    name: "Zona de Mancuernas",
    tagline: "El peso libre deja de dar miedo.",
    minPoints: 1500,
    milestones: [
      "Tu primer mes completo sin soltarlo",
      "Peso libre sin miedo: mancuernas y barra vacía",
      "Tu primer récord personal",
    ],
  },
  {
    code: "BANCO",
    name: "El Banco",
    tagline: "El lunes internacional del pecho.",
    minPoints: 2500,
    milestones: [
      "Press banca con técnica limpia",
      "Subir peso cada semana sin fallar series",
      "Tu primera rutina de cuatro días",
    ],
  },
  {
    code: "JAULA",
    name: "La Jaula",
    tagline: "El rack ya es tuyo.",
    minPoints: 4000,
    milestones: [
      "66 días: el hábito ya va solo",
      "Sentadilla con barra dentro del rack",
      "Tu primer disco de 20 kg por lado",
    ],
    byAudience: {
      MALE: [
        "66 días: el hábito ya va solo",
        "Sentadilla con barra dentro del rack",
        "Press banca con un disco por lado (60 kg)",
      ],
      FEMALE: [
        "66 días: el hábito ya va solo",
        "Sentadilla con barra dentro del rack",
        "Hip thrust con un disco por lado (60 kg)",
      ],
    },
  },
  {
    code: "PLATAFORMA",
    name: "La Plataforma",
    tagline: "Aquí se levanta del suelo.",
    minPoints: 6000,
    milestones: [
      "Peso muerto con tu peso corporal",
      "Pasar la semana 19, donde la mitad abandona",
      "Magnesio en las manos sin pedir permiso",
    ],
  },
  {
    code: "TEMPLO",
    name: "Templo del Hierro",
    tagline: "Las ganancias de novato, en su mejor momento.",
    minPoints: 9000,
    milestones: [
      "Tu primera dominada estricta",
      "Sentadilla con tu peso corporal",
      "Seis meses entrenando",
    ],
  },
  {
    code: "CUEVA",
    name: "La Cueva",
    tagline: "Sin espejos, sin excusas.",
    minPoints: 13000,
    milestones: [
      "Diez dominadas seguidas",
      "Entrenar solo y con la misma intensidad",
      "Tu primer bloque de fuerza de 8 semanas",
    ],
  },
  {
    code: "FRAGUA",
    name: "La Fragua",
    tagline: "Aquí se rompen los estancamientos.",
    minPoints: 18000,
    milestones: [
      "Romper tu primer estancamiento",
      "Tu primer bloque de periodización",
      "Peso muerto con 1,5 veces tu peso corporal",
    ],
    byAudience: {
      MALE: [
        "Romper tu primer estancamiento",
        "Tu primer bloque de periodización",
        "Press banca con dos discos por lado (100 kg)",
      ],
    },
  },
  {
    code: "STRONGMAN",
    name: "Patio Strongman",
    tagline: "Piedras, neumáticos y yugo.",
    minPoints: 24000,
    milestones: [
      "Un año entrenando sin parar",
      "Paseo del granjero con tu peso",
      "Ayudar a alguien con su técnica",
    ],
  },
  {
    code: "COLISEO",
    name: "El Coliseo",
    tagline: "Con público, el peso pesa distinto.",
    minPoints: 32000,
    milestones: [
      "Peso muerto con el doble de tu peso corporal",
      "Entrar en el club de los 1000 lb (o de los 500)",
      "Una rutina tuya que otros copian",
    ],
    byAudience: {
      MALE: [
        "Peso muerto con el doble de tu peso corporal",
        "Club de los 1000 lb: 450 kg entre sentadilla, banca y muerto",
        "Una rutina tuya que otros copian",
      ],
      FEMALE: [
        "Peso muerto con 1,75 veces tu peso corporal",
        "Club de las 500 lb: 225 kg entre sentadilla, banca y muerto",
        "Una rutina tuya que otras copian",
      ],
    },
  },
  {
    code: "VALHALLA",
    name: "Valhalla",
    tagline: "El salón de quienes no se rindieron.",
    minPoints: 42000,
    milestones: [
      "Tu primera competición o prueba oficial",
      "Dos años sin soltar la barra",
      "Sentadilla con 1,75 veces tu peso",
    ],
  },
  {
    code: "OLIMPO",
    name: "El Olimpo",
    tagline: "La cima. Muy pocos llegan.",
    minPoints: 55000,
    milestones: [
      "Dominadas con lastre de un cuarto de tu peso",
      "Tres años de constancia",
      "Ser quien enseña a los que acaban de entrar",
    ],
    byAudience: {
      MALE: [
        "Tres, cuatro y cinco discos: banca, sentadilla y muerto",
        "Tres años de constancia",
        "Ser quien enseña a los que acaban de entrar",
      ],
    },
  },
  {
    code: "LEYENDAS",
    name: "Salón de Leyendas",
    tagline: "Tu nombre ya es parte del gimnasio.",
    minPoints: 75000,
    milestones: [
      "Cinco años entrenando",
      "Nivel élite en un básico",
      "Alguien empezó a entrenar por ti",
    ],
  },
];

export interface ArenaView {
  code: string;
  /** 1 = la primera arena del camino. */
  order: number;
  name: string;
  tagline: string;
  minPoints: number;
  milestones: string[];
  unlocked: boolean;
  current: boolean;
}

/** Las arenas del camino para una rama y unos puntos. */
export function buildArenas(audience: ProgressionAudience, points: number): ArenaView[] {
  const unlockedCount = ARENAS.filter((arena) => points >= arena.minPoints).length;
  return ARENAS.map((arena, index) => ({
    code: arena.code,
    order: index + 1,
    name: arena.name,
    tagline: arena.tagline,
    minPoints: arena.minPoints,
    milestones: [...(arena.byAudience?.[audience] ?? arena.milestones)],
    unlocked: points >= arena.minPoints,
    current: index === unlockedCount - 1,
  }));
}
