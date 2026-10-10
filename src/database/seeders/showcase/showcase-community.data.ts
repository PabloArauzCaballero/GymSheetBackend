import { FitnessGoal, TrainingGoal } from '../../../common/enums/domain.enums';
import { block, r, t, TemplateDay } from './recommended-routines.data';

/**
 * Datos de demostración realistas para TEST (10_CORRECCIONES §C6): personas
 * `@demo.repp.test`, rutinas de comunidad, copias, valoraciones, comentarios,
 * programas con historia y «me gusta»/favoritos. Ficticios: ningún nombre
 * corresponde a una persona real.
 */

export const DEMO_DOMAIN = '@demo.repp.test';
export const OFFICIAL_AUTHOR_EMAIL = `equipo${DEMO_DOMAIN}`;
export const OFFICIAL_AUTHOR_NAME = 'Equipo REPP';

export type DemoUser = {
  key: string;
  email: string;
  fullName: string;
  coach: boolean;
  gender: 'MALE' | 'FEMALE';
  weightKg: number;
  heightCm: number;
  goal: FitnessGoal;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  frequency: number;
  location: 'GYM' | 'HOME' | 'OUTDOORS' | 'MIXED';
  equipment: string[];
  preferences: string[];
};

const user = (key: string, u: Omit<DemoUser, 'key' | 'email'>): DemoUser => ({ key, email: `${key}${DEMO_DOMAIN}`, ...u });
const GYM_ALL = ['Mancuernas', 'Barra y discos', 'Máquinas', 'Poleas', 'Banco'];

export const DEMO_USERS: readonly DemoUser[] = [
  user('valentina.rios', {
    fullName: 'Valentina Ríos', coach: false, gender: 'FEMALE', weightKg: 68, heightCm: 163,
    goal: FitnessGoal.LOSE_FAT, level: 'BEGINNER', frequency: 3, location: 'HOME',
    equipment: ['Mancuernas', 'Bandas', 'Peso corporal'], preferences: ['Entrenamiento funcional', 'Cardio'],
  }),
  user('mateo.fernandez', {
    fullName: 'Mateo Fernández', coach: false, gender: 'MALE', weightKg: 78, heightCm: 178,
    goal: FitnessGoal.GAIN_MUSCLE, level: 'INTERMEDIATE', frequency: 4, location: 'GYM',
    equipment: GYM_ALL, preferences: ['Hipertrofia'],
  }),
  user('camila.herrera', {
    fullName: 'Camila Herrera', coach: false, gender: 'FEMALE', weightKg: 59, heightCm: 160,
    goal: FitnessGoal.IMPROVE_STRENGTH, level: 'BEGINNER', frequency: 3, location: 'GYM',
    equipment: GYM_ALL, preferences: ['Fuerza'],
  }),
  user('diego.morales', {
    fullName: 'Diego Morales', coach: true, gender: 'MALE', weightKg: 84, heightCm: 181,
    goal: FitnessGoal.GAIN_MUSCLE, level: 'ADVANCED', frequency: 5, location: 'GYM',
    equipment: GYM_ALL, preferences: ['Hipertrofia', 'Fuerza'],
  }),
  user('lucia.navarro', {
    fullName: 'Lucía Navarro', coach: false, gender: 'FEMALE', weightKg: 55, heightCm: 167,
    goal: FitnessGoal.IMPROVE_ENDURANCE, level: 'INTERMEDIATE', frequency: 3, location: 'MIXED',
    equipment: ['Mancuernas', 'Bandas', 'Peso corporal'], preferences: ['Cardio', 'Movilidad'],
  }),
  user('andres.castillo', {
    fullName: 'Andrés Castillo', coach: false, gender: 'MALE', weightKg: 92, heightCm: 175,
    goal: FitnessGoal.GENERAL_HEALTH, level: 'BEGINNER', frequency: 2, location: 'GYM',
    equipment: ['Máquinas', 'Poleas'], preferences: ['Movilidad'],
  }),
  user('sofia.paredes', {
    fullName: 'Sofía Paredes', coach: false, gender: 'FEMALE', weightKg: 61, heightCm: 170,
    goal: FitnessGoal.SPORT_PERFORMANCE, level: 'INTERMEDIATE', frequency: 2, location: 'GYM',
    equipment: GYM_ALL, preferences: ['Entrenamiento funcional', 'Fuerza'],
  }),
  user('javier.ortega', {
    fullName: 'Javier Ortega', coach: false, gender: 'MALE', weightKg: 88, heightCm: 183,
    goal: FitnessGoal.IMPROVE_STRENGTH, level: 'ADVANCED', frequency: 5, location: 'GYM',
    equipment: GYM_ALL, preferences: ['Fuerza'],
  }),
];

export type CommunityRoutine = {
  key: string;
  author: string;
  nombre: string;
  descripcion: string;
  objetivo: TrainingGoal;
  duracionSemanas: number;
  dias: readonly TemplateDay[];
};

export const COMMUNITY_ROUTINES: readonly CommunityRoutine[] = [
  {
    key: 'diego-torso-pierna',
    author: 'diego.morales',
    nombre: 'Torso-pierna de Diego · 4 días',
    descripcion: 'La que uso con mis alumnos intermedios: básicos pesados al principio y bombeo al final. Sube el peso cuando llegues al tope de repeticiones.',
    objetivo: TrainingGoal.HYPERTROPHY,
    duracionSemanas: 8,
    dias: [
      { diaSemana: 1, nombre: 'Torso fuerte', ejercicios: [
        r('0025', 'barbell bench press', 4, [5, 7], 2, 180),
        r('0027', 'barbell bent over row', 4, [6, 8], 2, 150),
        r('0405', 'dumbbell seated shoulder press', 3, [8, 10], 2, 120),
        ...block(1, 15, [r('0294', 'dumbbell biceps curl', 3, [10, 12], 1, 60), r('0201', 'cable pushdown', 3, [10, 12], 1, 60)]),
      ] },
      { diaSemana: 2, nombre: 'Pierna fuerte', ejercicios: [
        r('0043', 'barbell full squat', 4, [5, 7], 2, 180),
        r('0085', 'barbell romanian deadlift', 3, [6, 8], 2, 150),
        r('0586', 'lever lying leg curl', 3, [10, 12], 1, 75),
        r('0605', 'lever standing calf raise', 4, [10, 12], 1, 60),
      ] },
      { diaSemana: 4, nombre: 'Torso bombeo', ejercicios: [
        r('0314', 'dumbbell incline bench press', 4, [8, 12], 1, 90),
        r('0198', 'cable pulldown', 4, [10, 12], 1, 90),
        r('0334', 'dumbbell lateral raise', 4, [15, 20], 1, 45),
        r('0233', 'cable standing rear delt row (with rope)', 3, [15, 15], 1, 45),
      ] },
      { diaSemana: 5, nombre: 'Pierna bombeo', ejercicios: [
        r('0739', 'sled 45в° leg press', 4, [12, 15], 1, 90),
        r('0585', 'lever leg extension', 3, [15, 15], 1, 60),
        r('0599', 'lever seated leg curl', 3, [12, 15], 1, 60),
        r('0594', 'lever seated calf raise', 4, [15, 15], 1, 45),
      ] },
    ],
  },
  {
    key: 'diego-gluteo-pierna',
    author: 'diego.morales',
    nombre: 'Glúteo y pierna · 2 días',
    descripcion: 'Dos días de tren inferior con énfasis en glúteo. Combínala con un día de torso a tu elección.',
    objetivo: TrainingGoal.HYPERTROPHY,
    duracionSemanas: 6,
    dias: [
      { diaSemana: 2, nombre: 'Glúteo', ejercicios: [
        r('1409', 'barbell glute bridge', 4, [8, 10], 2, 120, { nota: 'Pausa de 1 s arriba.' }),
        r('0410', 'dumbbell single leg split squat', 3, [10, 10], 2, 90),
        r('0432', 'dumbbell stiff leg deadlift', 3, [10, 12], 2, 90),
        r('0597', 'lever seated hip abduction', 3, [15, 20], 1, 45),
      ] },
      { diaSemana: 5, nombre: 'Cuádriceps', ejercicios: [
        r('0743', 'sled hack squat', 4, [8, 10], 2, 150),
        r('0336', 'dumbbell lunge', 3, [12, 12], 2, 90),
        r('0585', 'lever leg extension', 3, [12, 15], 1, 60),
        r('0417', 'dumbbell standing calf raise', 4, [12, 15], 1, 45),
      ] },
    ],
  },
  {
    key: 'mateo-pecho-espalda',
    author: 'mateo.fernandez',
    nombre: 'Pecho y espalda en 50 minutos',
    descripcion: 'Para los días con poco tiempo: todo en superseries de pecho y espalda. Me funciona bien a la hora del almuerzo.',
    objetivo: TrainingGoal.HYPERTROPHY,
    duracionSemanas: 6,
    dias: [
      { diaSemana: 3, nombre: 'Pecho-espalda', ejercicios: [
        ...block(1, 20, [r('0025', 'barbell bench press', 4, [6, 8], 2, 120), r('0652', 'pull-up', 4, [6, 8], 2, 120)]),
        ...block(2, 15, [r('0314', 'dumbbell incline bench press', 3, [10, 12], 2, 90), r('0861', 'cable seated row', 3, [10, 12], 2, 90)]),
        ...block(3, 15, [r('0227', 'cable standing fly', 3, [12, 15], 1, 60), r('0602', 'lever seated reverse fly', 3, [12, 15], 1, 60)]),
      ] },
    ],
  },
  {
    key: 'javier-basicos',
    author: 'javier.ortega',
    nombre: 'Fuerza 4 días: básicos pesados',
    descripcion: 'Sentadilla, banca, peso muerto y press militar, cada uno con su día. Series bajas, descansos largos y nada de fallo.',
    objetivo: TrainingGoal.STRENGTH,
    duracionSemanas: 10,
    dias: [
      { diaSemana: 1, nombre: 'Sentadilla', ejercicios: [
        r('0043', 'barbell full squat', 5, [3, 3], 2, 240),
        r('0042', 'barbell front squat', 3, [5, 5], 2, 180),
        r('0857', 'wheel rollerout', 3, [10, 10], 2, 60),
      ] },
      { diaSemana: 2, nombre: 'Banca', ejercicios: [
        r('0025', 'barbell bench press', 5, [3, 3], 2, 240),
        r('0030', 'barbell close-grip bench press', 3, [5, 5], 2, 180),
        r('3017', 'barbell pendlay row', 4, [5, 5], 2, 150),
      ] },
      { diaSemana: 4, nombre: 'Peso muerto', ejercicios: [
        r('0032', 'barbell deadlift', 5, [2, 3], 2, 300),
        r('0085', 'barbell romanian deadlift', 3, [5, 5], 2, 180),
        r('0652', 'pull-up', 4, [5, 5], 1, 120),
      ] },
      { diaSemana: 5, nombre: 'Press militar', ejercicios: [
        r('1456', 'barbell standing close grip military press', 5, [3, 5], 2, 210),
        r('0251', 'chest dip', 3, [6, 8], 2, 120),
        r('0233', 'cable standing rear delt row (with rope)', 3, [15, 15], 1, 60),
      ] },
    ],
  },
  {
    key: 'valentina-casa',
    author: 'valentina.rios',
    nombre: 'Full body en casa con mancuernas',
    descripcion: 'Lo que hago en casa tres veces por semana con un par de mancuernas y una banda. 45 minutos y listo.',
    objetivo: TrainingGoal.FAT_LOSS,
    duracionSemanas: 8,
    dias: [
      { diaSemana: 1, nombre: 'Lunes', ejercicios: [
        r('1760', 'dumbbell goblet squat', 3, [12, 15], 2, 75),
        r('0289', 'dumbbell bench press', 3, [10, 12], 2, 75),
        r('0292', 'dumbbell one arm bent-over row', 3, [10, 12], 2, 75),
        r('3013', 'low glute bridge on floor', 3, [15, 15], 2, 45),
      ] },
      { diaSemana: 3, nombre: 'Miércoles', ejercicios: [
        r('0336', 'dumbbell lunge', 3, [10, 10], 2, 75),
        r('0405', 'dumbbell seated shoulder press', 3, [10, 12], 2, 75),
        r('0988', 'band one arm standing low row', 3, [12, 15], 2, 60),
        r('1459', 'dumbbell romanian deadlift', 3, [12, 12], 2, 75),
      ] },
      { diaSemana: 5, nombre: 'Viernes', ejercicios: [
        r('0413', 'dumbbell squat', 3, [12, 12], 2, 75),
        r('0493', 'incline push-up', 3, [10, 15], 2, 60),
        r('0293', 'dumbbell bent over row', 3, [10, 12], 2, 75),
        r('0294', 'dumbbell biceps curl', 2, [12, 15], 1, 45),
      ] },
    ],
  },
  {
    key: 'lucia-trail',
    author: 'lucia.navarro',
    nombre: 'Fuerza para trail running',
    descripcion: 'Dos sesiones cortas para aguantar las bajadas: mucho trabajo a una pierna, gemelo y core. La hago los martes y viernes.',
    objetivo: TrainingGoal.ENDURANCE,
    duracionSemanas: 8,
    dias: [
      { diaSemana: 2, nombre: 'Martes', ejercicios: [
        r('0431', 'dumbbell step-up', 3, [10, 10], 2, 75),
        r('1757', 'dumbbell single leg deadlift', 3, [10, 10], 2, 75),
        r('0409', 'dumbbell single leg calf raise', 4, [15, 15], 2, 45),
        t('2135', 'weighted front plank', 3, 45, 45),
      ] },
      { diaSemana: 5, nombre: 'Viernes', ejercicios: [
        r('2368', 'split squats', 3, [12, 12], 2, 60),
        r('3645', 'single leg bridge with outstretched leg', 3, [12, 12], 2, 45),
        r('0417', 'dumbbell standing calf raise', 3, [20, 20], 2, 45),
        r('0276', 'dead bug', 3, [12, 12], null, 45),
      ] },
    ],
  },
  {
    key: 'sofia-futbol',
    author: 'sofia.paredes',
    nombre: 'Prevención para fútbol · 2 días',
    descripcion: 'Nórdicos, Copenhague y trabajo a una pierna. Desde que la hago no he vuelto a tener molestias en el isquio.',
    objetivo: TrainingGoal.GENERAL_HEALTH,
    duracionSemanas: 8,
    dias: [
      { diaSemana: 1, nombre: 'Lunes', ejercicios: [
        r('0496', 'inverse leg curl (bench support)', 3, [5, 6], 2, 120),
        r('1775', 'side plank hip adduction', 3, [10, 10], 2, 60),
        r('0410', 'dumbbell single leg split squat', 3, [8, 8], 2, 90),
      ] },
      { diaSemana: 4, nombre: 'Jueves', ejercicios: [
        r('0514', 'jump squat', 4, [5, 5], 3, 90),
        r('1757', 'dumbbell single leg deadlift', 3, [8, 8], 2, 90),
        r('0979', 'band horizontal pallof press', 3, [10, 10], null, 45),
      ] },
    ],
  },
];

/** Copias con atribución (C2: «Nombre · v1»). */
export const COMMUNITY_COPIES: ReadonlyArray<{ user: string; routine: string }> = [
  { user: 'camila.herrera', routine: 'diego-torso-pierna' },
  { user: 'andres.castillo', routine: 'valentina-casa' },
];

/** Estrellas por rutina (clave de comunidad o `plantilla` oficial) y quién las pone. Nunca el autor. */
export const RATINGS: ReadonlyArray<{ target: string; stars: ReadonlyArray<readonly [string, number]> }> = [
  { target: 'diego-torso-pierna', stars: [['mateo.fernandez', 5], ['camila.herrera', 4], ['javier.ortega', 5], ['sofia.paredes', 4], ['andres.castillo', 5]] },
  { target: 'diego-gluteo-pierna', stars: [['valentina.rios', 5], ['camila.herrera', 4], ['sofia.paredes', 4]] },
  { target: 'mateo-pecho-espalda', stars: [['diego.morales', 4], ['javier.ortega', 5], ['andres.castillo', 4], ['lucia.navarro', 5]] },
  { target: 'javier-basicos', stars: [['diego.morales', 5], ['mateo.fernandez', 4], ['camila.herrera', 4], ['sofia.paredes', 5], ['andres.castillo', 3]] },
  { target: 'valentina-casa', stars: [['lucia.navarro', 5], ['andres.castillo', 4], ['camila.herrera', 5], ['sofia.paredes', 4]] },
  { target: 'lucia-trail', stars: [['sofia.paredes', 5], ['valentina.rios', 4], ['diego.morales', 4]] },
  { target: 'sofia-futbol', stars: [['lucia.navarro', 4], ['diego.morales', 5], ['javier.ortega', 4]] },
  { target: 'repp-torso-pierna-4-dias', stars: [['mateo.fernandez', 5], ['diego.morales', 4], ['javier.ortega', 5], ['sofia.paredes', 4]] },
  { target: 'repp-fuerza-base-3-dias', stars: [['camila.herrera', 5], ['javier.ortega', 4], ['andres.castillo', 5]] },
  { target: 'repp-salud-total-3-dias', stars: [['andres.castillo', 5], ['valentina.rios', 4], ['lucia.navarro', 4]] },
  { target: 'repp-circuito-casa-3-dias', stars: [['valentina.rios', 5], ['lucia.navarro', 4], ['camila.herrera', 4]] },
  { target: 'repp-cuerpo-completo-3-dias', stars: [['camila.herrera', 4], ['andres.castillo', 5], ['mateo.fernandez', 4]] },
];

export type DemoComment = {
  key: string;
  target: string;
  author: string;
  text: string;
  /** Clave del comentario al que responde. */
  replyTo?: string;
  /** Se denuncia y un moderador lo oculta (para el backoffice). */
  moderate?: { reporter: string; reason: 'SPAM' | 'ACOSO' | 'OTRO' };
};

export const COMMENTS: readonly DemoComment[] = [
  { key: 'c1', target: 'diego-torso-pierna', author: 'mateo.fernandez', text: 'La llevo 5 semanas y subí 7,5 kg en sentadilla. El día de bombeo de pierna se sufre, pero vale la pena.' },
  { key: 'c1r', target: 'diego-torso-pierna', author: 'diego.morales', replyTo: 'c1', text: '¡Buenísimo, Mateo! Si te recuperas bien, prueba a sumar una serie a la prensa en la semana 6.' },
  { key: 'c2', target: 'diego-torso-pierna', author: 'camila.herrera', text: '¿El remo con barra lo hacen apoyando el pecho en un banco o de pie? Me molesta un poco la espalda baja.' },
  { key: 'c2r', target: 'diego-torso-pierna', author: 'diego.morales', replyTo: 'c2', text: 'De pie, pero si molesta cámbialo por remo en polea sentado sin problema. Mantén el abdomen firme.' },
  { key: 'c3', target: 'javier-basicos', author: 'diego.morales', text: 'Muy bien planteada. Yo añadiría una semana de descarga cada cuatro si alguien viene de poco volumen.' },
  { key: 'c3r', target: 'javier-basicos', author: 'javier.ortega', replyTo: 'c3', text: 'Buena idea. Quien venga de poco volumen, que active la descarga cada 4 semanas en la progresión.' },
  { key: 'c4', target: 'valentina-casa', author: 'andres.castillo', text: 'Ideal para los días que no llego al gimnasio. La copié y le cambié el curl por remo con banda.' },
  { key: 'c4r', target: 'valentina-casa', author: 'valentina.rios', replyTo: 'c4', text: '¡Me alegra que te sirva! Esa versión con remo queda incluso mejor.' },
  {
    key: 'c5', target: 'valentina-casa', author: 'javier.ortega',
    text: 'Esto no sirve para nada, si quieres resultados de verdad escríbeme por privado y te paso mi plan de pago.',
    moderate: { reporter: 'valentina.rios', reason: 'SPAM' },
  },
  { key: 'c6', target: 'lucia-trail', author: 'sofia.paredes', text: 'Las subidas al cajón con peso me salvaron en la última carrera de montaña. ¡Gracias, Lucía!' },
  { key: 'c6r', target: 'lucia-trail', author: 'lucia.navarro', replyTo: 'c6', text: '¡Qué bien! Cuando te resulten fáciles, prueba a bajar del cajón en 3 segundos.' },
  { key: 'c7', target: 'mateo-pecho-espalda', author: 'lucia.navarro', text: 'Corta y efectiva. ¿Cuánto descansas entre vueltas?' },
  { key: 'c7r', target: 'mateo-pecho-espalda', author: 'mateo.fernandez', replyTo: 'c7', text: 'Unos 2 minutos en la primera superserie y 60–90 s en las otras.' },
  { key: 'c8', target: 'repp-salud-total-3-dias', author: 'andres.castillo', text: 'Empecé con esta y en un mes ya subo las escaleras sin ahogarme. Muy clara.' },
  { key: 'c9', target: 'repp-torso-pierna-4-dias', author: 'mateo.fernandez', text: 'La mejor para mí: 4 días caben bien en la semana y el volumen está justo.' },
];

/** Programas activos con historia: el ledger sale del cierre semanal real. */
export type DemoProgram = {
  user: string;
  /** `plantilla` oficial (se usa la copia «· v1» de la persona) o clave de rutina propia de comunidad. */
  source: { plantilla: string } | { own: string };
  weeksAgo: number;
  /** Días (ISO) que se saltó, por semana: [semana, díaSemana]. */
  skipped: ReadonlyArray<readonly [number, number]>;
  /** kg de trabajo inicial por external_id; +2,5 kg por semana. */
  kg: Readonly<Record<string, number>>;
};

export const PROGRAMS: readonly DemoProgram[] = [
  {
    user: 'mateo.fernandez',
    source: { plantilla: 'repp-torso-pierna-4-dias' },
    weeksAgo: 3,
    skipped: [],
    kg: {
      '0025': 70, '0027': 60, '1456': 40, '0198': 55, '0031': 30, '0060': 25, '0334': 8,
      '0043': 90, '0085': 80, '0410': 16, '0586': 35, '0605': 60, '0857': 0,
      '0047': 55, '0652': 0, '0405': 20, '0861': 50, '0313': 14, '0200': 22, '0233': 20,
      '0739': 160, '1409': 90, '0585': 45, '0599': 35, '0594': 40, '0472': 0,
    },
  },
  {
    user: 'camila.herrera',
    source: { plantilla: 'repp-fuerza-base-3-dias' },
    weeksAgo: 2,
    skipped: [],
    kg: { '0043': 45, '0025': 30, '0027': 30, '1456': 22.5, '0032': 55, '0017': 20, '2135': 0 },
  },
  {
    user: 'valentina.rios',
    source: { own: 'valentina-casa' },
    weeksAgo: 3,
    skipped: [[2, 5]],
    kg: {
      '1760': 14, '0289': 10, '0292': 10, '3013': 0, '0336': 8, '0405': 8, '0988': 0, '1459': 12,
      '0413': 12, '0493': 0, '0293': 10, '0294': 7,
    },
  },
];

/** Ejercicios con «me gusta» y favoritos (≈30), repartidos entre las personas. */
export const LIKED_EXERCISES: readonly string[] = [
  '0025', '0027', '0031', '0032', '0043', '0047', '0085', '0198', '0233', '0289',
  '0292', '0294', '0313', '0314', '0334', '0405', '0410', '0586', '0605', '0652',
  '0739', '0861', '1409', '1459', '1760', '2135', '0276', '0979', '3013', '0549',
];
