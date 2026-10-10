import { TrainingGoal } from '../../../common/enums/domain.enums';

/**
 * Plantillas «Recomendadas por REPP» (10_CORRECCIONES §C7, anexo 10a).
 *
 * Fuente de verdad del catálogo oficial: el seeder `routines-showcase` las
 * siembra tal cual y `GET /routines/recommended` elige entre ellas por
 * `metadata`. Cada ejercicio se resuelve por `external_id` del snapshot del
 * catálogo y se comprueba contra su nombre inglés exacto: si falta o no
 * coincide, la siembra FALLA (nunca se cuela un ejercicio equivocado).
 *
 * Convenciones (evidencia en 10a):
 * - Superseries SOLO de antagonistas (empuje/tracción, bíceps/tríceps,
 *   cuádriceps/isquios, pecho/deltoide posterior). Nunca el mismo músculo.
 * - `descanso` = segundos tras la serie; en un bloque, el del último ejercicio
 *   es el descanso tras la vuelta y `entre` es la transición dentro del bloque.
 * - kg siempre null: la carga la pone cada persona (o el programa).
 * - Descarga cada 4–5 semanas con volumen 0,5–0,6 y carga 0,9.
 *
 * PENDIENTE DE REVISIÓN HUMANA (P5) antes de enseñarlas como definitivas.
 */

export type TemplateLevel = 'PRINCIPIANTE' | 'INTERMEDIO' | 'AVANZADO' | 'TODOS';
export type TemplatePlace = 'GYM' | 'HOME';
/**
 * Equipo de la plantilla. Los siete primeros son los de `equipmentOptions`
 * del onboarding (Mancuernas, Barra y discos, Máquinas, Bandas, Poleas, Banco,
 * Peso corporal); los demás solo aparecen en plantillas de gimnasio.
 */
export type TemplateEquipment =
  | 'MANCUERNAS'
  | 'BARRA'
  | 'MAQUINAS'
  | 'BANDAS'
  | 'POLEAS'
  | 'BANCO'
  | 'PESO_CORPORAL'
  | 'KETTLEBELL'
  | 'BALON_MEDICINAL'
  | 'MAQUINAS_CARDIO';
export type TemplateSubgoal = 'MANTENER' | 'DEPORTE';
export type TemplateMode = 'PROGRESSIVE_OVERLOAD' | 'STRENGTH_GOALS';

export type TemplateExercise = {
  /** external_id del snapshot (`src/database/seeders/boot/exercises.snapshot.json.gz`). */
  readonly id: string;
  /** Nombre inglés EXACTO del snapshot: la siembra lo comprueba. */
  readonly en: string;
  readonly series: number;
  readonly reps: readonly [number, number] | null;
  /** Serie por tiempo (segundos); excluye `reps`. */
  readonly seg: number | null;
  readonly rir: number | null;
  readonly descanso: number;
  readonly grupo: number | null;
  readonly entre: number | null;
  readonly nota: string | null;
};

export type TemplateDay = {
  /** ISO: 1 = lunes … 7 = domingo. */
  readonly diaSemana: number;
  readonly nombre: string;
  readonly ejercicios: readonly TemplateExercise[];
};

export type TemplateWeekOverride = {
  readonly semana: number;
  readonly factorVolumen: number;
  readonly nota: string;
};

export type RecommendedTemplate = {
  /** Clave natural: `metadata.plantilla`. */
  readonly plantilla: string;
  readonly numero: number;
  readonly nombre: string;
  readonly descripcion: string;
  readonly objetivo: TrainingGoal;
  readonly subobjetivo: TemplateSubgoal | null;
  readonly nivel: TemplateLevel;
  readonly lugar: readonly TemplatePlace[];
  readonly equipo: readonly TemplateEquipment[];
  readonly minSesion: number;
  readonly duracionSemanas: number;
  readonly modo: TemplateMode;
  readonly progresion: {
    readonly descargaCada: 4 | 5 | 6 | null;
    readonly volumenDescarga: number;
    readonly cargaDescarga: number;
  };
  /** Plan de cardio que acompaña a la plantilla (se describe; no se siembra). */
  readonly planCardio: string | null;
  /** Aviso clínico obligatorio (solo «Vuelta suave»). */
  readonly aviso: string | null;
  /** Fuera de `GET /routines/recommended` salvo que el objetivo coincida (rehabilitación). */
  readonly soloSiObjetivo: boolean;
  readonly semanas: readonly TemplateWeekOverride[];
  readonly dias: readonly TemplateDay[];
};

type Extra = { nota?: string; rir?: number | null };

/** Serie por repeticiones. */
export function r(
  id: string,
  en: string,
  series: number,
  reps: readonly [number, number],
  rir: number | null,
  descanso: number,
  extra: Extra = {},
): TemplateExercise {
  return {
    id,
    en,
    series,
    reps,
    seg: null,
    rir: extra.rir !== undefined ? extra.rir : rir,
    descanso,
    grupo: null,
    entre: null,
    nota: extra.nota ?? null,
  };
}

/** Serie por tiempo. */
export function t(
  id: string,
  en: string,
  series: number,
  seg: number,
  descanso: number,
  extra: Extra = {},
): TemplateExercise {
  return {
    id,
    en,
    series,
    reps: null,
    seg,
    rir: extra.rir ?? null,
    descanso,
    grupo: null,
    entre: null,
    nota: extra.nota ?? null,
  };
}

/**
 * Bloque (superserie con 2, circuito con 3+). `entre` es la transición dentro
 * del bloque; el `descanso` del último es el de la vuelta. A los anteriores se
 * les deja `descanso = entre` para que el entrenamiento guiado no espere de más.
 */
export function block(grupo: number, entre: number, items: readonly TemplateExercise[]): TemplateExercise[] {
  return items.map((item, index) => ({
    ...item,
    grupo,
    entre,
    descanso: index === items.length - 1 ? item.descanso : entre,
  }));
}

const DELOAD_4 = { descargaCada: 4, volumenDescarga: 0.6, cargaDescarga: 0.9 } as const;
const DELOAD_5 = { descargaCada: 5, volumenDescarga: 0.6, cargaDescarga: 0.9 } as const;
const DELOAD_5_STRENGTH = { descargaCada: 5, volumenDescarga: 0.5, cargaDescarga: 0.9 } as const;
const NO_DELOAD = { descargaCada: null, volumenDescarga: 0.6, cargaDescarga: 0.9 } as const;

// Ejercicios reutilizados (id, nombre exacto del snapshot).
const BB_BENCH = ['0025', 'barbell bench press'] as const;
const BB_ROW = ['0027', 'barbell bent over row'] as const;
const BB_CURL = ['0031', 'barbell curl'] as const;
const BB_DEADLIFT = ['0032', 'barbell deadlift'] as const;
const BB_FRONT_SQUAT = ['0042', 'barbell front squat'] as const;
const BB_SQUAT = ['0043', 'barbell full squat'] as const;
const BB_GOOD_MORNING = ['0044', 'barbell good morning'] as const;
const BB_INCLINE = ['0047', 'barbell incline bench press'] as const;
const BB_SKULL = ['0060', 'barbell lying triceps extension skull crusher'] as const;
const BB_RDL = ['0085', 'barbell romanian deadlift'] as const;
const BB_CLOSE_BENCH = ['0030', 'barbell close-grip bench press'] as const;
const BB_PRESS = ['1456', 'barbell standing close grip military press'] as const;
const BB_HIP = ['1409', 'barbell glute bridge'] as const;
const BB_PENDLAY = ['3017', 'barbell pendlay row'] as const;
const TRAP_DL = ['0811', 'trap bar deadlift'] as const;

const DB_BENCH = ['0289', 'dumbbell bench press'] as const;
const DB_ROW_1 = ['0292', 'dumbbell one arm bent-over row'] as const;
const DB_ROW = ['0293', 'dumbbell bent over row'] as const;
const DB_CURL = ['0294', 'dumbbell biceps curl'] as const;
const DB_HAMMER = ['0313', 'dumbbell hammer curl'] as const;
const DB_INCLINE = ['0314', 'dumbbell incline bench press'] as const;
const DB_FLY = ['0308', 'dumbbell fly'] as const;
const DB_KICKBACK = ['0333', 'dumbbell kickback'] as const;
const DB_LATERAL = ['0334', 'dumbbell lateral raise'] as const;
const DB_LUNGE = ['0336', 'dumbbell lunge'] as const;
const DB_PREACHER = ['0372', 'dumbbell preacher curl'] as const;
const DB_REAR_RAISE = ['0380', 'dumbbell rear lateral raise'] as const;
const DB_REAR_LUNGE = ['0381', 'dumbbell rear lunge'] as const;
const DB_SHOULDER = ['0405', 'dumbbell seated shoulder press'] as const;
const DB_BULGARIAN = ['0410', 'dumbbell single leg split squat'] as const;
const DB_SL_CALF = ['0409', 'dumbbell single leg calf raise'] as const;
const DB_CALF = ['0417', 'dumbbell standing calf raise'] as const;
const DB_STEP = ['0431', 'dumbbell step-up'] as const;
const DB_STIFF = ['0432', 'dumbbell stiff leg deadlift'] as const;
const DB_RDL = ['1459', 'dumbbell romanian deadlift'] as const;
const DB_GOBLET = ['1760', 'dumbbell goblet squat'] as const;
const DB_SL_DL = ['1757', 'dumbbell single leg deadlift'] as const;
const DB_PUSH_PRESS = ['1700', 'dumbbell push press'] as const;
const DB_TRICEPS = ['2188', 'dumbbell seated triceps extension'] as const;

const C_LATERAL = ['0178', 'cable lateral raise'] as const;
const C_KNEEL_CRUNCH = ['0175', 'cable kneeling crunch'] as const;
const C_PULLDOWN = ['0198', 'cable pulldown'] as const;
const C_PUSHDOWN = ['0201', 'cable pushdown'] as const;
const C_PUSHDOWN_ROPE = ['0200', 'cable pushdown (with rope attachment)'] as const;
const C_OVERHEAD_ROPE = ['0194', 'cable overhead triceps extension (rope attachment)'] as const;
const C_FLY = ['0227', 'cable standing fly'] as const;
const C_FACE_PULL = ['0233', 'cable standing rear delt row (with rope)'] as const;
const C_ROW = ['0861', 'cable seated row'] as const;
const C_CURL = ['0868', 'cable curl'] as const;

const M_ASSISTED_PULLUP = ['0017', 'assisted pull-up'] as const;
const M_BACK_EXT = ['0573', 'lever back extension'] as const;
const M_CHEST = ['0576', 'lever chest press'] as const;
const M_PULLDOWN = ['0579', 'lever front pulldown'] as const;
const M_LEG_EXT = ['0585', 'lever leg extension'] as const;
const M_LYING_CURL = ['0586', 'lever lying leg curl'] as const;
const M_SEATED_CALF = ['0594', 'lever seated calf raise'] as const;
const M_SEATED_CURL = ['0599', 'lever seated leg curl'] as const;
const M_REVERSE_FLY = ['0602', 'lever seated reverse fly'] as const;
const M_SHOULDER = ['0603', 'lever shoulder press'] as const;
const M_CALF = ['0605', 'lever standing calf raise'] as const;
const M_INCLINE = ['1299', 'lever incline chest press'] as const;
const M_ROW = ['1350', 'lever seated row'] as const;
const LEG_PRESS = ['0739', 'sled 45в° leg press'] as const;
const HACK = ['0743', 'sled hack squat'] as const;

const BW_DIP = ['0251', 'chest dip'] as const;
const BW_DEAD_BUG = ['0276', 'dead bug'] as const;
const BW_HANGING_RAISE = ['0472', 'hanging leg raise'] as const;
const BW_NORDIC = ['0496', 'inverse leg curl (bench support)'] as const;
const BW_INCLINE_PUSHUP = ['0493', 'incline push-up'] as const;
const BW_INV_ROW = ['0499', 'inverted row'] as const;
const BW_JUMP_SQUAT = ['0514', 'jump squat'] as const;
const BW_MOUNTAIN = ['0630', 'mountain climber'] as const;
const BW_PULLUP = ['0652', 'pull-up'] as const;
const BW_WALL_PUSHUP = ['0659', 'push-up (wall)'] as const;
const BW_PUSHUP = ['0662', 'push-up'] as const;
const BW_RUN = ['0685', 'run'] as const;
const BW_SIDE_BRIDGE = ['0705', 'side bridge v. 2'] as const;
const BW_SIDE_HIP = ['0710', 'side hip abduction'] as const;
const BW_CALF = ['1373', 'bodyweight standing calf raise'] as const;
const BW_WALKING_LUNGE = ['1460', 'walking lunge'] as const;
const BW_COPENHAGEN = ['1775', 'side plank hip adduction'] as const;
const BW_SPLIT = ['2368', 'split squats'] as const;
const BW_GLUTE_BRIDGE = ['3013', 'low glute bridge on floor'] as const;
const BW_CHAIR_SQUAT = ['3132', 'potty squat with support'] as const;
const BW_SQUAT = ['3533', 'quads'] as const;
const BW_SL_BRIDGE = ['3645', 'single leg bridge with outstretched leg'] as const;
const PLANK = ['2135', 'weighted front plank'] as const;
const AB_WHEEL = ['0857', 'wheel rollerout'] as const;
const BURPEE = ['1160', 'burpee'] as const;

const B_PULLAPART = ['0993', 'band reverse fly'] as const;
const B_ROW_1 = ['0988', 'band one arm standing low row'] as const;
const B_CURL = ['0968', 'band alternating biceps curl'] as const;
const B_CLOSE_PUSHUP = ['0975', 'band close-grip push-up'] as const;
const B_CLOSE_PULLDOWN = ['0974', 'band close-grip pulldown'] as const;
const B_PALLOF = ['0979', 'band horizontal pallof press'] as const;
const B_PULL_THROUGH = ['0991', 'band pull through'] as const;
const B_SHOULDER = ['0997', 'band shoulder press'] as const;
const B_TRICEPS = ['0998', 'band side triceps extension'] as const;
const B_SPLIT = ['1001', 'band single leg split squat'] as const;
const B_SQUAT = ['1004', 'band squat'] as const;
const B_STEP = ['1008', 'band step-up'] as const;
const B_STIFF = ['1009', 'band stiff leg deadlift'] as const;
const B_UNDER_PULLDOWN = ['1013', 'band underhand pulldown'] as const;
const B_BENCH = ['1254', 'band bench press'] as const;
const B_CALF = ['1369', 'band two legs calf raise - (band under both legs) v. 2'] as const;
const B_HIP_LIFT = ['1408', 'band hip lift'] as const;
const RB_SHOULDER = ['3122', 'resistance band seated shoulder press'] as const;
const RB_CHEST = ['3124', 'resistance band seated chest press'] as const;
const RB_ROW = ['3144', 'resistance band seated straight back row'] as const;

const KB_SWING = ['0549', 'kettlebell swing'] as const;
const FARMER = ['2133', 'farmers walk'] as const;
const MB_SLAM = ['1354', 'medicine ball overhead slam'] as const;
const BIKE = ['2138', 'stationary bike run v. 3'] as const;
const SKIERG = ['2142', 'ski ergometer'] as const;
const STEPMILL = ['2311', 'walking on stepmill'] as const;

type Ref = readonly [string, string];
const R = (ex: Ref, series: number, reps: readonly [number, number], rir: number | null, descanso: number, extra?: Extra) =>
  r(ex[0], ex[1], series, reps, rir, descanso, extra);
const T = (ex: Ref, series: number, seg: number, descanso: number, extra?: Extra) => t(ex[0], ex[1], series, seg, descanso, extra);

const PLANK_NOTE = 'Antebrazos en el suelo, cuerpo en línea. Sin lastre hasta dominar 45 s.';
const HIP_THRUST_NOTE = 'Hip thrust: espalda alta apoyada en un banco si puedes; si no, desde el suelo.';

export const RECOMMENDED_TEMPLATES: readonly RecommendedTemplate[] = [
  {
    plantilla: 'repp-cuerpo-completo-3-dias',
    numero: 1,
    nombre: 'Cuerpo completo 3 días · Hipertrofia base',
    descripcion:
      'Tres sesiones de cuerpo completo para empezar a ganar músculo: cada grupo se trabaja 3 veces por semana con 8–12 repeticiones a 2 del fallo. Las superseries de pecho y espalda ahorran tiempo sin perder rendimiento. Sube +2,5 kg arriba y +5 kg abajo cuando completes todas las series en el tope de repeticiones.',
    objetivo: TrainingGoal.HYPERTROPHY,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM'],
    equipo: ['MANCUERNAS', 'BARRA', 'POLEAS', 'MAQUINAS', 'BANCO'],
    minSesion: 55,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A · Cuerpo completo',
        ejercicios: [
          R(DB_GOBLET, 3, [8, 12], 2, 120),
          ...block(1, 20, [R(DB_BENCH, 3, [8, 12], 2, 90), R(DB_ROW_1, 3, [10, 12], 2, 90)]),
          R(DB_RDL, 3, [10, 10], 2, 120),
          ...block(2, 15, [R(DB_CURL, 2, [12, 15], 2, 60), R(C_PUSHDOWN, 2, [12, 15], 2, 60)]),
          T(PLANK, 3, 40, 60, { nota: `30–45 s. ${PLANK_NOTE}` }),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Día B · Cuerpo completo',
        ejercicios: [
          R(BB_HIP, 3, [10, 10], 2, 120, { nota: HIP_THRUST_NOTE }),
          R(DB_SHOULDER, 3, [8, 12], 2, 120),
          R(C_PULLDOWN, 3, [10, 12], 2, 90),
          R(DB_REAR_LUNGE, 2, [10, 10], 2, 90, { nota: '10 por pierna.' }),
          R(M_CALF, 3, [12, 15], 1, 60),
          R(BW_DEAD_BUG, 3, [10, 10], null, 45, { nota: '10 por lado, lumbar pegada al suelo.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día C · Cuerpo completo',
        ejercicios: [
          R(LEG_PRESS, 3, [10, 12], 2, 120),
          ...block(1, 20, [R(DB_INCLINE, 3, [8, 12], 2, 90), R(C_ROW, 3, [10, 12], 2, 90)]),
          R(M_LYING_CURL, 3, [10, 12], 2, 90),
          ...block(2, 15, [R(DB_HAMMER, 2, [12, 15], 2, 60), R(C_OVERHEAD_ROPE, 2, [12, 15], 2, 60)]),
          R(C_KNEEL_CRUNCH, 3, [12, 15], 2, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-torso-pierna-4-dias',
    numero: 2,
    nombre: 'Torso-Pierna 4 días',
    descripcion:
      'División torso/pierna para quien ya entrena: cada músculo 2 veces por semana y 12–14 series semanales. Básicos de 6–8 repeticiones con descansos largos y accesorios de 10–15. Descarga en la semana 5 y 10.',
    objetivo: TrainingGoal.HYPERTROPHY,
    subobjetivo: null,
    nivel: 'INTERMEDIO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'POLEAS', 'MAQUINAS', 'BANCO'],
    minSesion: 65,
    duracionSemanas: 10,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_5,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Torso 1',
        ejercicios: [
          R(BB_BENCH, 4, [6, 8], 2, 150),
          ...block(1, 30, [R(BB_ROW, 4, [8, 10], 2, 120), R(BB_PRESS, 3, [8, 10], 2, 120)]),
          R(C_PULLDOWN, 3, [10, 12], 2, 90),
          ...block(2, 15, [R(BB_CURL, 3, [10, 12], 2, 75), R(BB_SKULL, 3, [10, 12], 2, 75)]),
          R(DB_LATERAL, 3, [12, 20], 1, 60),
        ],
      },
      {
        diaSemana: 2,
        nombre: 'Pierna 1',
        ejercicios: [
          R(BB_SQUAT, 4, [6, 8], 2, 180),
          R(BB_RDL, 3, [8, 10], 2, 150),
          R(DB_BULGARIAN, 3, [10, 10], 2, 90, { nota: 'Sentadilla búlgara: 10 por pierna.' }),
          R(M_LYING_CURL, 3, [10, 15], 1, 75),
          R(M_CALF, 4, [10, 15], 1, 60),
          R(AB_WHEEL, 3, [8, 12], 2, 60),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Torso 2',
        ejercicios: [
          R(BB_INCLINE, 4, [8, 10], 2, 150),
          R(BW_PULLUP, 4, [6, 10], 2, 120, { nota: 'Con asistencia o banda si no llegas a 6.' }),
          ...block(1, 20, [R(DB_SHOULDER, 3, [10, 12], 2, 90), R(C_ROW, 3, [10, 12], 2, 90)]),
          ...block(2, 15, [R(DB_HAMMER, 3, [10, 12], 2, 60), R(C_PUSHDOWN_ROPE, 3, [10, 15], 2, 60)]),
          R(C_FACE_PULL, 3, [12, 15], 1, 60, { nota: 'Face pull: tira la cuerda hacia la frente, codos altos.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Pierna 2',
        ejercicios: [
          R(LEG_PRESS, 4, [10, 12], 2, 150),
          R(BB_HIP, 4, [8, 10], 2, 120, { nota: HIP_THRUST_NOTE }),
          ...block(1, 15, [R(M_LEG_EXT, 3, [12, 15], 1, 75), R(M_SEATED_CURL, 3, [10, 15], 1, 75)]),
          R(M_SEATED_CALF, 4, [12, 15], 1, 60),
          R(BW_HANGING_RAISE, 3, [8, 12], 2, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-empuje-tiron-pierna-6-dias',
    numero: 3,
    nombre: 'Empuje-Tirón-Pierna 5–6 días',
    descripcion:
      'PPL dos veces por semana para avanzados: 16–20 series por músculo y semana, básicos a RIR 1–2 y aislamientos cerca del fallo. Si solo tienes 5 días, haz los seis entrenamientos seguidos y descansa cuando toque (la semana se alarga). Descarga cada 5 semanas.',
    objetivo: TrainingGoal.HYPERTROPHY,
    subobjetivo: null,
    nivel: 'AVANZADO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'POLEAS', 'MAQUINAS', 'BANCO'],
    minSesion: 70,
    duracionSemanas: 10,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_5,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Empuje A',
        ejercicios: [
          R(BB_BENCH, 4, [6, 8], 2, 180),
          R(DB_INCLINE, 3, [8, 10], 1, 120),
          R(BB_PRESS, 3, [6, 8], 2, 150),
          R(C_LATERAL, 4, [12, 20], 1, 60),
          R(C_FLY, 3, [12, 15], 1, 60),
          ...block(1, 15, [R(BB_SKULL, 3, [10, 12], 1, 60), R(C_PUSHDOWN_ROPE, 3, [12, 15], 1, 75)]),
        ],
      },
      {
        diaSemana: 2,
        nombre: 'Tirón A',
        ejercicios: [
          R(BB_DEADLIFT, 3, [5, 5], 2, 180),
          R(BW_PULLUP, 4, [6, 10], 1, 120),
          R(BB_ROW, 4, [8, 10], 2, 120),
          R(C_FACE_PULL, 3, [12, 15], 1, 60),
          R(BB_CURL, 3, [8, 12], 1, 75),
          R(DB_HAMMER, 3, [10, 12], 1, 60),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Pierna A',
        ejercicios: [
          R(BB_SQUAT, 4, [6, 8], 2, 180),
          R(BB_RDL, 4, [8, 10], 2, 150),
          R(LEG_PRESS, 3, [10, 12], 1, 120),
          R(M_LYING_CURL, 3, [10, 15], 1, 75),
          R(M_CALF, 5, [10, 15], 1, 60),
          R(AB_WHEEL, 3, [8, 12], 2, 60),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Empuje B',
        ejercicios: [
          R(BB_INCLINE, 4, [8, 10], 2, 150),
          R(DB_BENCH, 3, [10, 12], 1, 90),
          R(DB_SHOULDER, 3, [8, 12], 1, 120),
          R(DB_LATERAL, 4, [12, 20], 1, 60),
          R(BW_DIP, 3, [8, 12], 1, 90),
          R(C_OVERHEAD_ROPE, 3, [12, 15], 1, 60),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Tirón B',
        ejercicios: [
          R(C_PULLDOWN, 4, [8, 12], 1, 90),
          R(DB_ROW_1, 3, [10, 12], 1, 90),
          R(C_ROW, 3, [10, 12], 1, 90),
          R(M_REVERSE_FLY, 3, [12, 20], 1, 60),
          R(C_CURL, 3, [10, 15], 1, 60),
          R(DB_PREACHER, 3, [10, 12], 1, 60),
        ],
      },
      {
        diaSemana: 6,
        nombre: 'Pierna B',
        ejercicios: [
          R(HACK, 4, [8, 10], 2, 150),
          R(BB_HIP, 4, [8, 12], 2, 120, { nota: HIP_THRUST_NOTE }),
          R(DB_BULGARIAN, 3, [10, 10], 1, 90, { nota: '10 por pierna.' }),
          ...block(1, 15, [R(M_LEG_EXT, 3, [12, 15], 1, 60), R(M_SEATED_CURL, 3, [10, 15], 1, 75)]),
          R(M_SEATED_CALF, 4, [12, 15], 1, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-hipertrofia-expres-2-dias',
    numero: 4,
    nombre: 'Hipertrofia exprés 2 días · 45 min',
    descripcion:
      'Dos sesiones de 45 minutos hechas íntegramente en superseries de antagonistas (unas 36 % más cortas sin perder estímulo). Solo necesitas mancuernas y un banco: vale para casa o para un gimnasio con poco tiempo.',
    objetivo: TrainingGoal.HYPERTROPHY,
    subobjetivo: null,
    nivel: 'TODOS',
    lugar: ['GYM', 'HOME'],
    equipo: ['MANCUERNAS', 'BANCO'],
    minSesion: 45,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A · Superseries',
        ejercicios: [
          ...block(1, 15, [R(DB_BENCH, 3, [8, 12], 2, 90), R(DB_ROW, 3, [8, 12], 2, 90)]),
          ...block(2, 15, [R(DB_GOBLET, 3, [10, 12], 2, 90), R(DB_RDL, 3, [10, 12], 2, 90)]),
          ...block(3, 15, [R(DB_SHOULDER, 3, [10, 12], 2, 60), R(DB_REAR_RAISE, 3, [12, 15], 1, 60)]),
          ...block(4, 10, [R(DB_CURL, 2, [12, 15], 1, 60), R(DB_TRICEPS, 2, [12, 15], 1, 60)]),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Día B · Superseries',
        ejercicios: [
          ...block(1, 15, [R(DB_INCLINE, 3, [8, 12], 2, 90), R(DB_ROW_1, 3, [10, 12], 2, 90)]),
          ...block(2, 15, [R(DB_BULGARIAN, 3, [10, 10], 2, 90, { nota: '10 por pierna.' }), R(DB_STIFF, 3, [10, 12], 2, 90)]),
          ...block(3, 15, [R(DB_FLY, 3, [12, 15], 1, 60), R(DB_REAR_RAISE, 3, [12, 15], 1, 60)]),
          ...block(4, 10, [R(DB_HAMMER, 2, [12, 15], 1, 60), R(DB_KICKBACK, 2, [12, 15], 1, 60)]),
          R(DB_CALF, 3, [12, 15], 1, 45),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-fuerza-base-3-dias',
    numero: 5,
    nombre: 'Fuerza base 3 días (5×5 adaptado)',
    descripcion:
      'Fuerza lineal para principiantes con los grandes básicos a 3×5 y RIR 2 (sin llegar al fallo), descansos de 3–4 minutos. Alterna A y B: una semana A-B-A y la siguiente B-A-B. Si completas las 5 repeticiones en todas las series sube +2,5 kg arriba y +5 kg abajo; tras 2 sesiones fallidas baja un 5 %.',
    objetivo: TrainingGoal.STRENGTH,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM'],
    equipo: ['BARRA', 'BANCO', 'MAQUINAS'],
    minSesion: 60,
    duracionSemanas: 12,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_5_STRENGTH,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A',
        ejercicios: [
          R(BB_SQUAT, 3, [5, 5], 2, 210),
          R(BB_BENCH, 3, [5, 5], 2, 180),
          R(BB_ROW, 3, [5, 5], 2, 180),
          T(PLANK, 3, 30, 60, { nota: PLANK_NOTE }),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Día B',
        ejercicios: [
          R(BB_SQUAT, 3, [5, 5], 2, 210),
          R(BB_PRESS, 3, [5, 5], 2, 180),
          R(BB_DEADLIFT, 1, [5, 5], 2, 240, { nota: 'Semana 1: 1×5. Desde la semana 2: 2×5.' }),
          R(M_ASSISTED_PULLUP, 3, [5, 8], 2, 120),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día A (repite)',
        ejercicios: [
          R(BB_SQUAT, 3, [5, 5], 2, 210),
          R(BB_BENCH, 3, [5, 5], 2, 180),
          R(BB_ROW, 3, [5, 5], 2, 180),
          T(PLANK, 3, 30, 60, { nota: 'La semana siguiente este día es B.' }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-fuerza-torso-pierna-ondulante',
    numero: 6,
    nombre: 'Fuerza Torso-Pierna 4 días (ondulante)',
    descripcion:
      'Periodización ondulante: un día pesado (3–5 repeticiones) y un día de volumen (6–8) para torso y pierna. Pensada para trabajar con metas de 1RM (modo «Objetivos de fuerza»): la app ajusta el peso de trabajo semana a semana.',
    objetivo: TrainingGoal.STRENGTH,
    subobjetivo: null,
    nivel: 'INTERMEDIO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'POLEAS', 'MAQUINAS', 'BANCO'],
    minSesion: 70,
    duracionSemanas: 12,
    modo: 'STRENGTH_GOALS',
    progresion: DELOAD_4,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Torso pesado',
        ejercicios: [
          R(BB_BENCH, 5, [3, 5], 2, 240),
          R(BB_ROW, 4, [5, 6], 2, 180),
          R(BB_PRESS, 3, [5, 6], 2, 180),
          R(BW_PULLUP, 3, [5, 8], 2, 150, { nota: 'Con lastre si haces más de 8.' }),
          R(BB_CLOSE_BENCH, 3, [6, 8], 2, 120),
        ],
      },
      {
        diaSemana: 2,
        nombre: 'Pierna pesada',
        ejercicios: [
          R(BB_SQUAT, 5, [3, 5], 2, 240),
          R(BB_DEADLIFT, 3, [3, 5], 2, 240),
          R(DB_BULGARIAN, 3, [6, 8], 2, 120, { nota: 'Por pierna.' }),
          R(M_LYING_CURL, 3, [8, 10], 2, 90),
          R(AB_WHEEL, 3, [8, 10], 2, 60),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Torso volumen',
        ejercicios: [
          R(BB_INCLINE, 4, [6, 8], 2, 150),
          R(BB_PENDLAY, 4, [6, 8], 2, 150),
          R(DB_SHOULDER, 3, [8, 10], 2, 120),
          R(C_PULLDOWN, 3, [8, 10], 2, 90),
          ...block(1, 15, [R(BB_CURL, 3, [8, 10], 2, 75), R(BB_SKULL, 3, [8, 10], 2, 75)]),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Pierna volumen',
        ejercicios: [
          R(BB_FRONT_SQUAT, 4, [6, 8], 2, 180),
          R(BB_RDL, 4, [6, 8], 2, 150),
          R(LEG_PRESS, 3, [8, 10], 2, 120),
          R(M_CALF, 4, [8, 12], 1, 60),
          R(BW_HANGING_RAISE, 3, [8, 12], 2, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-fuerza-2-dias',
    numero: 7,
    nombre: 'Fuerza 2 días · cuerpo completo',
    descripcion:
      'Dos días de cuerpo completo para ganar fuerza con poco tiempo. Los básicos de pierna van solos y con descanso largo; solo el tren superior se hace en superserie empuje/tracción.',
    objetivo: TrainingGoal.STRENGTH,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'POLEAS', 'BANCO'],
    minSesion: 60,
    duracionSemanas: 10,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_5_STRENGTH,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A',
        ejercicios: [
          R(BB_SQUAT, 3, [5, 5], 2, 210),
          ...block(1, 30, [R(BB_BENCH, 3, [5, 5], 2, 150), R(BB_ROW, 3, [6, 6], 2, 150)]),
          R(BB_RDL, 3, [6, 8], 2, 150),
          T(PLANK, 3, 40, 60, { nota: PLANK_NOTE }),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Día B',
        ejercicios: [
          R(BB_DEADLIFT, 3, [5, 5], 2, 240),
          ...block(1, 30, [R(BB_PRESS, 3, [5, 5], 2, 150), R(C_PULLDOWN, 3, [6, 8], 2, 150)]),
          R(DB_BULGARIAN, 3, [8, 8], 2, 120, { nota: 'Por pierna.' }),
          R(BW_DEAD_BUG, 3, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-powerbuilding-5-dias',
    numero: 8,
    nombre: 'Powerbuilding 5 días',
    descripcion:
      'Cuatro días centrados en un básico (sentadilla, banca, peso muerto y press militar) a 2–5 repeticiones y un quinto día de hipertrofia en superseries. Para avanzados con metas de 1RM.',
    objetivo: TrainingGoal.STRENGTH,
    subobjetivo: null,
    nivel: 'AVANZADO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'POLEAS', 'MAQUINAS', 'BANCO'],
    minSesion: 75,
    duracionSemanas: 10,
    modo: 'STRENGTH_GOALS',
    progresion: DELOAD_5_STRENGTH,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Sentadilla',
        ejercicios: [
          R(BB_SQUAT, 5, [3, 5], 1, 240),
          R(BB_FRONT_SQUAT, 3, [6, 6], 2, 180),
          R(M_LYING_CURL, 3, [8, 12], 1, 90),
          R(M_CALF, 4, [10, 12], 1, 60),
          R(AB_WHEEL, 3, [10, 10], 2, 60),
        ],
      },
      {
        diaSemana: 2,
        nombre: 'Press de banca',
        ejercicios: [
          R(BB_BENCH, 5, [3, 5], 1, 240),
          R(BB_CLOSE_BENCH, 3, [6, 8], 2, 150),
          R(BB_ROW, 4, [6, 8], 2, 150),
          R(DB_LATERAL, 3, [12, 15], 1, 60),
          R(C_PUSHDOWN, 3, [10, 12], 1, 60),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Peso muerto',
        ejercicios: [
          R(BB_DEADLIFT, 4, [2, 4], 2, 300),
          R(BB_GOOD_MORNING, 3, [8, 8], 2, 150),
          R(BW_PULLUP, 4, [6, 8], 1, 120),
          R(C_FACE_PULL, 3, [15, 15], 1, 60),
          R(BB_CURL, 3, [8, 10], 1, 75),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Press militar',
        ejercicios: [
          R(BB_PRESS, 5, [3, 5], 1, 210),
          R(BB_INCLINE, 4, [6, 8], 2, 150),
          R(C_PULLDOWN, 4, [8, 10], 1, 90),
          R(BW_DIP, 3, [8, 10], 1, 90),
          R(DB_HAMMER, 3, [10, 12], 1, 60),
        ],
      },
      {
        diaSemana: 6,
        nombre: 'Hipertrofia',
        ejercicios: [
          ...block(1, 15, [R(DB_INCLINE, 3, [10, 12], 1, 90), R(C_ROW, 3, [10, 12], 1, 90)]),
          ...block(2, 15, [R(LEG_PRESS, 3, [12, 15], 1, 90), R(M_SEATED_CURL, 3, [12, 15], 1, 90)]),
          ...block(3, 10, [R(C_CURL, 3, [12, 15], 1, 60), R(C_OVERHEAD_ROPE, 3, [12, 15], 1, 60)]),
          R(M_SEATED_CALF, 3, [15, 15], 1, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-recomposicion-3-dias',
    numero: 9,
    nombre: 'Recomposición 3 días + cardio',
    descripcion:
      'Pesas de cuerpo completo para conservar (y ganar) músculo mientras pierdes grasa, con superseries para ahorrar tiempo. Acompáñala de 2–3 sesiones de cardio en zona 2 de 30–40 minutos los días sin pesas.',
    objetivo: TrainingGoal.FAT_LOSS,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM'],
    equipo: ['MANCUERNAS', 'BARRA', 'POLEAS', 'MAQUINAS', 'BANCO'],
    minSesion: 55,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Zona 2: 2–3 sesiones de 30–40 min por semana (bici, elíptica o caminata inclinada).',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día 1 · Cuerpo completo',
        ejercicios: [
          R(DB_GOBLET, 3, [10, 12], 2, 120),
          ...block(1, 15, [R(M_CHEST, 3, [10, 12], 2, 75), R(C_ROW, 3, [10, 12], 2, 75)]),
          R(DB_RDL, 3, [10, 12], 2, 120),
          ...block(2, 15, [R(C_FLY, 2, [12, 15], 1, 60), R(C_FACE_PULL, 2, [12, 15], 1, 60)]),
          T(PLANK, 3, 40, 45, { nota: PLANK_NOTE }),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Día 2 · Cuerpo completo',
        ejercicios: [
          R(LEG_PRESS, 3, [12, 12], 2, 120),
          ...block(1, 15, [R(DB_SHOULDER, 3, [10, 12], 2, 75), R(C_PULLDOWN, 3, [10, 12], 2, 75)]),
          R(M_LYING_CURL, 3, [12, 12], 2, 75),
          ...block(2, 10, [R(DB_CURL, 2, [12, 15], 1, 60), R(C_PUSHDOWN, 2, [12, 15], 1, 60)]),
          R(BW_DEAD_BUG, 3, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día 3 · Cuerpo completo',
        ejercicios: [
          R(DB_REAR_LUNGE, 3, [10, 10], 2, 90, { nota: '10 por pierna.' }),
          ...block(1, 15, [R(DB_BENCH, 3, [10, 12], 2, 75), R(DB_ROW_1, 3, [10, 12], 2, 75)]),
          R(BB_HIP, 3, [12, 12], 2, 90, { nota: HIP_THRUST_NOTE }),
          R(M_CALF, 3, [12, 15], 1, 60),
          R(C_KNEEL_CRUNCH, 3, [12, 15], 2, 45),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-quema-4-dias',
    numero: 10,
    nombre: 'Quema 4 días · Torso-Pierna + HIIT',
    descripcion:
      'Torso-pierna con superseries y un bloque corto de HIIT (8–10 × 30 s fuerte / 90 s suave) al final de los días de torso, nunca después de la pierna pesada para no restar fuerza.',
    objetivo: TrainingGoal.FAT_LOSS,
    subobjetivo: null,
    nivel: 'INTERMEDIO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'POLEAS', 'MAQUINAS', 'BANCO', 'MAQUINAS_CARDIO'],
    minSesion: 60,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Opcional: 1–2 caminatas de 30 min en zona 2 los días de descanso.',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Torso A + HIIT',
        ejercicios: [
          R(BB_BENCH, 3, [6, 8], 2, 150),
          ...block(1, 20, [R(DB_SHOULDER, 3, [8, 10], 2, 90), R(C_PULLDOWN, 3, [8, 10], 2, 90)]),
          ...block(2, 15, [R(M_CHEST, 3, [10, 12], 2, 75), R(C_ROW, 3, [10, 12], 2, 75)]),
          ...block(3, 10, [R(C_CURL, 2, [12, 15], 1, 60), R(C_PUSHDOWN, 2, [12, 15], 1, 60)]),
          T(BIKE, 8, 30, 90, { nota: 'HIIT: 30 s a tope y 90 s pedaleo suave.' }),
        ],
      },
      {
        diaSemana: 2,
        nombre: 'Pierna A',
        ejercicios: [
          R(BB_SQUAT, 3, [6, 8], 2, 180),
          R(BB_RDL, 3, [8, 10], 2, 150),
          R(DB_LUNGE, 3, [10, 10], 2, 90, { nota: '10 por pierna.' }),
          R(M_LYING_CURL, 3, [10, 12], 1, 75),
          R(M_CALF, 3, [12, 15], 1, 60),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Torso B + HIIT',
        ejercicios: [
          R(BB_INCLINE, 3, [8, 10], 2, 150),
          ...block(1, 30, [R(BB_ROW, 3, [8, 10], 2, 120), R(BB_PRESS, 3, [8, 10], 2, 120)]),
          ...block(2, 15, [R(C_FLY, 2, [12, 15], 1, 60), R(M_REVERSE_FLY, 2, [12, 15], 1, 60)]),
          T(SKIERG, 8, 30, 90, { nota: 'HIIT: 30 s a tope y 90 s suave (vale bici o remo).' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Pierna B',
        ejercicios: [
          R(LEG_PRESS, 3, [10, 12], 2, 150),
          R(BB_HIP, 3, [8, 10], 2, 120, { nota: HIP_THRUST_NOTE }),
          ...block(1, 15, [R(M_LEG_EXT, 3, [12, 15], 1, 75), R(M_SEATED_CURL, 3, [12, 15], 1, 75)]),
          R(M_SEATED_CALF, 3, [12, 15], 1, 60),
          R(BW_HANGING_RAISE, 3, [10, 10], 2, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-circuito-casa-3-dias',
    numero: 11,
    nombre: 'Circuito metabólico en casa 3 días',
    descripcion:
      'Circuitos de 6 ejercicios con 40 s de trabajo y 20 s de pausa, 3 vueltas (4 desde la semana 3). Solo peso corporal y una banda elástica. Para progresar: primero más vueltas, después más repeticiones en los 40 s y por último una variante más difícil.',
    objetivo: TrainingGoal.FAT_LOSS,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['HOME', 'GYM'],
    equipo: ['BANDAS', 'PESO_CORPORAL'],
    minSesion: 35,
    duracionSemanas: 6,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: NO_DELOAD,
    planCardio: 'Caminar 30 min los días sin circuito.',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Circuito A',
        ejercicios: block(1, 20, [
          T(BW_SQUAT, 3, 40, 20),
          T(BW_INCLINE_PUSHUP, 3, 40, 20, { nota: 'Manos en una mesa o sofá; más bajo = más difícil.' }),
          T(B_ROW_1, 3, 40, 20, { nota: '20 s por brazo.' }),
          T(BW_GLUTE_BRIDGE, 3, 40, 20),
          T(BW_SPLIT, 3, 40, 20, { nota: 'Cambia de pierna a los 20 s.' }),
          T(BW_DEAD_BUG, 3, 40, 90),
        ]),
      },
      {
        diaSemana: 3,
        nombre: 'Circuito B',
        ejercicios: block(1, 20, [
          T(B_SQUAT, 3, 40, 20),
          T(BW_PUSHUP, 3, 40, 20, { nota: 'Con rodillas apoyadas si hace falta.' }),
          T(RB_ROW, 3, 40, 20),
          T(B_PULL_THROUGH, 3, 40, 20),
          T(BW_WALKING_LUNGE, 3, 40, 20),
          T(PLANK, 3, 40, 90, { nota: 'Sin lastre.' }),
        ]),
      },
      {
        diaSemana: 5,
        nombre: 'Circuito C',
        ejercicios: block(1, 20, [
          T(BW_SQUAT, 3, 40, 20, { nota: 'Baja en 3 segundos.' }),
          T(BW_INCLINE_PUSHUP, 3, 40, 20),
          T(B_PULLAPART, 3, 40, 20),
          T(B_HIP_LIFT, 3, 40, 20),
          T(BW_SPLIT, 3, 40, 20),
          T(BW_MOUNTAIN, 3, 40, 90, { nota: 'Ritmo cómodo; no es un sprint.' }),
        ]),
      },
    ],
  },
  {
    plantilla: 'repp-minimo-eficaz-2-dias',
    numero: 12,
    nombre: 'Mínimo eficaz 2 días + caminatas',
    descripcion:
      'Lo mínimo que funciona para perder grasa sin perder músculo: dos sesiones en superseries con mancuernas y 5 caminatas de 30 minutos a la semana.',
    objetivo: TrainingGoal.FAT_LOSS,
    subobjetivo: null,
    nivel: 'TODOS',
    lugar: ['GYM', 'HOME'],
    equipo: ['MANCUERNAS', 'BANCO'],
    minSesion: 40,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Caminatas: 5 × 30 min por semana a paso vivo.',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 2,
        nombre: 'Día A · Superseries',
        ejercicios: [
          ...block(1, 15, [R(DB_BENCH, 3, [10, 12], 2, 75), R(DB_ROW_1, 3, [10, 12], 2, 75)]),
          ...block(2, 15, [R(DB_GOBLET, 3, [12, 15], 2, 75), R(DB_RDL, 3, [12, 12], 2, 75)]),
          ...block(3, 10, [R(DB_SHOULDER, 2, [12, 15], 2, 60), R(DB_REAR_RAISE, 2, [12, 15], 1, 60)]),
          T(PLANK, 3, 40, 45, { nota: PLANK_NOTE }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día B · Superseries',
        ejercicios: [
          ...block(1, 15, [R(DB_INCLINE, 3, [10, 12], 2, 75), R(DB_ROW, 3, [10, 12], 2, 75)]),
          ...block(2, 15, [R(DB_LUNGE, 3, [10, 10], 2, 75, { nota: '10 por pierna.' }), R(DB_STIFF, 3, [12, 12], 2, 75)]),
          ...block(3, 10, [R(DB_CURL, 2, [12, 15], 1, 60), R(DB_TRICEPS, 2, [12, 15], 1, 60)]),
          R(BW_DEAD_BUG, 3, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-fuerza-corredores-2-dias',
    numero: 13,
    nombre: 'Fuerza para corredores 2 días',
    descripcion:
      'Fuerza unilateral, gemelo y core para correr mejor y lesionarte menos. Va con un plan de 3 carreras por semana: haz la fuerza después de un rodaje suave o en un día sin carrera, nunca antes de las series.',
    objetivo: TrainingGoal.ENDURANCE,
    subobjetivo: null,
    nivel: 'TODOS',
    lugar: ['GYM', 'HOME'],
    equipo: ['MANCUERNAS', 'BANCO'],
    minSesion: 40,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Correr 3 veces por semana: 2 rodajes en zona 2 y 1 sesión de calidad (80/20).',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 2,
        nombre: 'Día A · Unilateral',
        ejercicios: [
          R(DB_BULGARIAN, 3, [6, 8], 2, 120, { nota: 'Por pierna.' }),
          R(DB_SL_DL, 3, [8, 8], 2, 90, { nota: 'Por pierna.' }),
          R(DB_SL_CALF, 3, [12, 15], 2, 60, { nota: 'Por pierna.' }),
          T(PLANK, 3, 40, 45, { nota: PLANK_NOTE }),
          T(BW_SIDE_BRIDGE, 3, 30, 45, { nota: '30 s por lado.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día B · Cadena posterior',
        ejercicios: [
          R(DB_GOBLET, 3, [8, 10], 2, 120),
          R(DB_STEP, 3, [8, 8], 2, 90, { nota: 'Por pierna, en un banco o cajón firme.' }),
          R(BW_SL_BRIDGE, 3, [10, 10], 2, 60, { nota: 'Por pierna.' }),
          ...block(1, 15, [R(DB_BENCH, 2, [10, 12], 3, 75), R(DB_ROW_1, 2, [10, 12], 3, 75)]),
          R(BW_DEAD_BUG, 3, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-hibrido-3-dias',
    numero: 14,
    nombre: 'Acondicionamiento híbrido 3 días',
    descripcion:
      'Fuerza con RIR 2–3 y acondicionamiento en el mismo plan: intervalos de 4 × 4 min en zona 4, trabajo de kettlebell y resistencia muscular de 12–20 repeticiones con descansos cortos.',
    objetivo: TrainingGoal.ENDURANCE,
    subobjetivo: null,
    nivel: 'INTERMEDIO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'KETTLEBELL', 'BANCO', 'MAQUINAS_CARDIO'],
    minSesion: 60,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: '1–2 sesiones extra de 30–45 min en zona 2.',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Fuerza + 4×4',
        ejercicios: [
          R(BB_SQUAT, 3, [5, 6], 2, 180),
          ...block(1, 30, [R(BB_BENCH, 3, [6, 8], 2, 120), R(BB_ROW, 3, [8, 8], 2, 120)]),
          T(SKIERG, 4, 240, 180, { nota: '4 × 4 min en zona 4 con 3 min suaves (vale remo o bici).' }),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Bisagra + kettlebell',
        ejercicios: [
          R(BB_DEADLIFT, 3, [5, 5], 3, 180),
          ...block(1, 30, [R(BB_PRESS, 3, [8, 8], 2, 120), R(BW_PULLUP, 3, [6, 8], 2, 120)]),
          R(KB_SWING, 4, [15, 15], 2, 75),
          T(FARMER, 4, 40, 90, { nota: 'Pesado pero con postura perfecta.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Resistencia muscular',
        ejercicios: [
          R(DB_LUNGE, 3, [12, 12], 2, 60, { nota: '12 por pierna.' }),
          ...block(1, 15, [R(BW_PUSHUP, 3, [12, 20], 2, 60), R(BW_INV_ROW, 3, [10, 15], 2, 60)]),
          T(BURPEE, 6, 30, 60),
          T(STEPMILL, 1, 1200, 0, { nota: 'Zona 2: 20 min a ritmo de conversación.' }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-base-aerobica-4-semanas',
    numero: 15,
    nombre: 'Base aeróbica 4 semanas',
    descripcion:
      'Solo cardio para construir la base: tres salidas por semana en zona 2 (puedes hablar en frases cortas). Sube un 10 % el tiempo cada semana como máximo.',
    objetivo: TrainingGoal.ENDURANCE,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM', 'HOME'],
    equipo: ['PESO_CORPORAL'],
    minSesion: 35,
    duracionSemanas: 4,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: NO_DELOAD,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Rodaje suave',
        ejercicios: [T(BW_RUN, 1, 1500, 0, { nota: '25 min en zona 2. Si hace falta, alterna caminar y trotar.' })],
      },
      {
        diaSemana: 3,
        nombre: 'Trote por bloques',
        ejercicios: [T(BW_RUN, 4, 300, 60, { nota: '4 × 5 min trotando con 1 min caminando.' })],
      },
      {
        diaSemana: 6,
        nombre: 'Rodaje largo',
        ejercicios: [T(BW_RUN, 1, 1800, 0, { nota: '30 min en zona 2, el más largo de la semana.' })],
      },
    ],
  },
  {
    plantilla: 'repp-primeros-pasos-maquinas',
    numero: 16,
    nombre: 'Primeros pasos 2 días · máquinas',
    descripcion:
      'Tu primera rutina: máquinas guiadas para aprender los movimientos con seguridad. Las semanas 1 y 2 son de adaptación (2 series); desde la semana 3, 3 series. Deja 3 repeticiones en reserva.',
    objetivo: TrainingGoal.GENERAL_HEALTH,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM'],
    equipo: ['MAQUINAS', 'POLEAS'],
    minSesion: 45,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Caminar 150 min por semana.',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [
      { semana: 1, factorVolumen: 0.67, nota: 'Semana de adaptación: 2 series por ejercicio.' },
      { semana: 2, factorVolumen: 0.67, nota: 'Semana de adaptación: 2 series por ejercicio.' },
    ],
    dias: [
      {
        diaSemana: 2,
        nombre: 'Día A · Máquinas',
        ejercicios: [
          R(LEG_PRESS, 3, [10, 12], 3, 90),
          R(M_CHEST, 3, [10, 12], 3, 90),
          R(M_PULLDOWN, 3, [10, 12], 3, 90),
          R(M_LYING_CURL, 3, [10, 12], 3, 90),
          R(M_SHOULDER, 3, [10, 12], 3, 90),
          R(C_KNEEL_CRUNCH, 3, [12, 12], 3, 60),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día B · Máquinas',
        ejercicios: [
          R(M_LEG_EXT, 3, [12, 12], 3, 90),
          R(M_ROW, 3, [10, 12], 3, 90),
          R(M_INCLINE, 3, [10, 12], 3, 90),
          R(M_SEATED_CURL, 3, [12, 12], 3, 90),
          R(M_CALF, 3, [12, 15], 3, 60),
          R(M_BACK_EXT, 3, [12, 12], 3, 60),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-salud-total-3-dias',
    numero: 17,
    nombre: 'Salud total 3 días · cuerpo completo',
    descripcion:
      'La rutina por defecto de REPP: fuerza de todos los grupos grandes 3 días por semana, como recomienda la OMS, con 2–3 series de 10–12. RIR 3 las dos primeras semanas y RIR 2 desde la tercera. Súmale 150 minutos de caminata a la semana.',
    objetivo: TrainingGoal.GENERAL_HEALTH,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['GYM'],
    equipo: ['MANCUERNAS', 'POLEAS', 'MAQUINAS', 'BANDAS', 'BANCO'],
    minSesion: 45,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Caminar 150 min por semana (por ejemplo, 5 × 30 min).',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A',
        ejercicios: [
          R(DB_GOBLET, 3, [10, 12], 3, 90),
          R(DB_BENCH, 3, [10, 12], 3, 90),
          R(C_ROW, 3, [10, 12], 3, 90),
          R(BW_GLUTE_BRIDGE, 2, [12, 12], 3, 60),
          R(B_PALLOF, 2, [10, 10], null, 45, { nota: '10 por lado: que el tronco no gire.' }),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Día B',
        ejercicios: [
          R(DB_RDL, 3, [10, 12], 3, 90, { nota: 'Con mancuernas o una kettlebell.' }),
          R(DB_SHOULDER, 3, [10, 12], 3, 90),
          R(C_PULLDOWN, 3, [10, 12], 3, 90),
          R(DB_STEP, 2, [10, 10], 3, 60, { nota: '10 por pierna.' }),
          R(BW_DEAD_BUG, 2, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día C',
        ejercicios: [
          R(LEG_PRESS, 3, [10, 12], 3, 90),
          R(BW_INCLINE_PUSHUP, 3, [10, 12], 3, 60),
          R(DB_ROW_1, 3, [10, 12], 3, 60),
          R(DB_REAR_LUNGE, 2, [10, 10], 3, 60, { nota: '10 por pierna.' }),
          T(PLANK, 2, 30, 45, { nota: PLANK_NOTE }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-casa-bandas-3-dias',
    numero: 18,
    nombre: 'En casa con bandas 3 días',
    descripcion:
      'Cuerpo completo en casa con bandas elásticas, todo en superseries de antagonistas a 3 × 12–15. Para subir, usa una banda más dura o acorta el agarre.',
    objetivo: TrainingGoal.GENERAL_HEALTH,
    subobjetivo: null,
    nivel: 'PRINCIPIANTE',
    lugar: ['HOME', 'GYM'],
    equipo: ['BANDAS'],
    minSesion: 40,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: 'Caminar 150 min por semana.',
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A',
        ejercicios: [
          ...block(1, 15, [R(B_BENCH, 3, [12, 15], 2, 75), R(RB_ROW, 3, [12, 15], 2, 75)]),
          ...block(2, 15, [R(B_SQUAT, 3, [12, 15], 2, 75), R(B_STIFF, 3, [12, 15], 2, 75)]),
          ...block(3, 10, [R(B_CURL, 2, [12, 15], 2, 60), R(B_TRICEPS, 2, [12, 15], 2, 60)]),
          R(B_PALLOF, 2, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
      {
        diaSemana: 3,
        nombre: 'Día B',
        ejercicios: [
          ...block(1, 15, [R(B_SHOULDER, 3, [12, 15], 2, 75), R(B_UNDER_PULLDOWN, 3, [12, 15], 2, 75)]),
          ...block(2, 15, [R(B_SPLIT, 3, [12, 12], 2, 75, { nota: '12 por pierna.' }), R(B_PULL_THROUGH, 3, [12, 15], 2, 75)]),
          ...block(3, 10, [R(RB_CHEST, 2, [12, 15], 2, 60), R(B_PULLAPART, 2, [15, 15], 2, 60)]),
          R(BW_DEAD_BUG, 2, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
      {
        diaSemana: 5,
        nombre: 'Día C',
        ejercicios: [
          ...block(1, 15, [R(B_CLOSE_PUSHUP, 3, [8, 12], 2, 75), R(B_ROW_1, 3, [12, 15], 2, 75)]),
          ...block(2, 15, [R(B_STEP, 3, [10, 12], 2, 75, { nota: 'Por pierna.' }), R(B_HIP_LIFT, 3, [12, 15], 2, 75)]),
          ...block(3, 10, [R(RB_SHOULDER, 2, [12, 15], 2, 60), R(B_CLOSE_PULLDOWN, 2, [12, 15], 2, 60)]),
          R(B_CALF, 3, [15, 15], 2, 45),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-atleta-complementario-2-dias',
    numero: 19,
    nombre: 'Atleta complementario 2 días',
    descripcion:
      'Complemento para quien practica un deporte: potencia con cargas ligeras (30–50 %) movidas a máxima velocidad, fuerza unilateral y prevención (nórdico y Copenhague). Nunca el mismo día del partido o del entrenamiento duro de tu deporte.',
    objetivo: TrainingGoal.GENERAL_HEALTH,
    subobjetivo: 'DEPORTE',
    nivel: 'INTERMEDIO',
    lugar: ['GYM'],
    equipo: ['BARRA', 'MANCUERNAS', 'BALON_MEDICINAL', 'BANCO'],
    minSesion: 50,
    duracionSemanas: 8,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: DELOAD_4,
    planCardio: null,
    aviso: null,
    soloSiObjetivo: false,
    semanas: [],
    dias: [
      {
        diaSemana: 2,
        nombre: 'Día A · Potencia y pierna',
        ejercicios: [
          R(BW_JUMP_SQUAT, 4, [4, 5], 3, 120, { nota: 'Máxima velocidad, aterrizaje suave. Peso corporal o 30–50 % con barra.' }),
          R(TRAP_DL, 4, [4, 6], 2, 180),
          R(DB_BULGARIAN, 3, [6, 8], 2, 120, { nota: 'Por pierna.' }),
          R(BW_NORDIC, 3, [4, 6], 2, 120, { nota: 'Nórdico: baja lo más lento que puedas.' }),
          R(BW_COPENHAGEN, 3, [8, 8], 2, 60, { nota: 'Copenhague: 8 por lado.' }),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Día B · Potencia y torso',
        ejercicios: [
          R(DB_PUSH_PRESS, 4, [4, 4], 3, 120, { nota: 'Explosivo con las piernas.' }),
          R(MB_SLAM, 3, [6, 6], 3, 90),
          ...block(1, 30, [R(BB_BENCH, 3, [5, 6], 2, 120), R(BW_PULLUP, 3, [5, 8], 2, 120)]),
          R(DB_STEP, 3, [6, 6], 2, 90, { nota: 'Por pierna, subida rápida.' }),
          R(B_PALLOF, 3, [10, 10], null, 45, { nota: '10 por lado.' }),
        ],
      },
    ],
  },
  {
    plantilla: 'repp-vuelta-suave',
    numero: 20,
    nombre: 'Vuelta suave · movilidad y fuerza básica',
    descripcion:
      'Para retomar el movimiento después de un parón: fuerza básica muy controlada, 2 series, lejos del fallo. Si algo duele, para.',
    objetivo: TrainingGoal.REHABILITATION,
    subobjetivo: null,
    nivel: 'TODOS',
    lugar: ['HOME', 'GYM'],
    equipo: ['BANDAS', 'PESO_CORPORAL'],
    minSesion: 30,
    duracionSemanas: 4,
    modo: 'PROGRESSIVE_OVERLOAD',
    progresion: NO_DELOAD,
    planCardio: 'Caminar 10–20 min al día si te sienta bien.',
    aviso:
      'No sustituye a un fisioterapeuta. Si vienes de una lesión, una operación o tienes dolor, consulta antes con un profesional de la salud.',
    soloSiObjetivo: true,
    semanas: [],
    dias: [
      {
        diaSemana: 1,
        nombre: 'Día A',
        ejercicios: [
          R(BW_GLUTE_BRIDGE, 2, [10, 10], 4, 60),
          R(BW_WALL_PUSHUP, 2, [10, 10], 4, 60),
          R(B_ROW_1, 2, [12, 12], 4, 60, { nota: 'Por brazo, sin tirones.' }),
          R(BW_CHAIR_SQUAT, 2, [8, 8], 4, 60, { nota: 'Siéntate y levántate de una silla con apoyo.' }),
          R(BW_DEAD_BUG, 2, [6, 6], null, 45, { nota: '6 por lado, muy lento.' }),
          R(BW_CALF, 2, [10, 10], 4, 45),
        ],
      },
      {
        diaSemana: 4,
        nombre: 'Día B',
        ejercicios: [
          R(BW_SIDE_HIP, 2, [10, 10], 4, 45, { nota: '10 por lado.' }),
          R(B_PULLAPART, 2, [12, 12], 4, 45),
          R(BW_SQUAT, 2, [8, 8], 4, 60, { nota: 'Hasta donde no duela; puedes bajar a una silla.' }),
          R(B_PALLOF, 2, [8, 8], null, 45, { nota: '8 por lado.' }),
          R(BW_SPLIT, 2, [6, 6], 4, 60, { nota: 'Con una mano apoyada en la pared.' }),
          T(BW_SIDE_BRIDGE, 2, 15, 45, { nota: 'Rodillas apoyadas; 15 s por lado.' }),
        ],
      },
    ],
  },
];

/** La rutina por defecto cuando no hay datos de la persona (§C7 regla 6). */
export const DEFAULT_TEMPLATE = 'repp-salud-total-3-dias';
