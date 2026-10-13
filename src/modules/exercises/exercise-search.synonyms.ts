/**
 * Sinónimos coloquiales del buscador de ejercicios (español e inglés).
 *
 * Cada entrada es un grupo: cualquiera de sus `terms` (ya normalizados: sin
 * acentos, en minúsculas) hace que se busquen todos sus `targets`. El catálogo
 * tiene el nombre original en inglés y, para buena parte, el nombre en español,
 * así que los `targets` llevan las dos lenguas: «dominadas» encuentra tanto
 * «Dominada con agarre ancho» como «pull-up».
 *
 * Para añadir uno: escribe los términos como los teclearía alguien en el
 * gimnasio y, en `targets`, las palabras que de verdad aparecen en los nombres
 * del catálogo. Los plurales regulares no hace falta listarlos.
 */
export type SynonymGroup = { readonly terms: readonly string[]; readonly targets: readonly string[] };

export const EXERCISE_SYNONYMS: readonly SynonymGroup[] = [
  // ── Movimientos
  { terms: ['press banca', 'press de banca', 'pres banca', 'bench press', 'bench', 'banca'], targets: ['press de banca', 'bench press'] },
  { terms: ['sentadilla', 'squat', 'sentadillas'], targets: ['sentadilla', 'squat'] },
  { terms: ['peso muerto', 'deadlift', 'pm'], targets: ['peso muerto', 'deadlift'] },
  { terms: ['dominada', 'pull up', 'pullup', 'chin up', 'chinup', 'barras'], targets: ['dominada', 'pull up', 'chin up'] },
  { terms: ['flexion', 'flexiones', 'lagartija', 'push up', 'pushup', 'pechada'], targets: ['flexiones de brazos', 'push up'] },
  { terms: ['fondo', 'fondos', 'dip'], targets: ['fondo', 'dip'] },
  { terms: ['remo', 'row'], targets: ['remo', 'row'] },
  { terms: ['jalon', 'jalones', 'pulldown', 'pull down', 'lat pulldown', 'polea al pecho'], targets: ['jalon', 'pulldown'] },
  { terms: ['hip thrust', 'empuje de cadera', 'puente de gluteo', 'puente de gluteos', 'glute bridge', 'puente'], targets: ['hip thrust', 'empuje de cadera', 'glute bridge', 'puente de gluteos'] },
  { terms: ['zancada', 'desplante', 'estocada', 'lunge', 'tijera'], targets: ['zancada', 'lunge'] },
  { terms: ['plancha', 'plank'], targets: ['plancha', 'plank'] },
  { terms: ['abdominal', 'abdominales', 'abdomen', 'crunch', 'crunches', 'abs', 'sit up', 'situp'], targets: ['abdominal', 'crunch', 'sit up', 'abs', 'waist'] },
  { terms: ['press militar', 'militar', 'military press', 'overhead press', 'ohp', 'press de hombro', 'press hombro', 'press de hombros', 'shoulder press'], targets: ['press militar', 'military press', 'overhead press', 'press de hombros', 'shoulder press'] },
  { terms: ['elevacion lateral', 'elevaciones laterales', 'laterales', 'lateral raise', 'vuelos laterales', 'vuelos'], targets: ['elevacion lateral', 'lateral raise'] },
  { terms: ['elevacion frontal', 'elevaciones frontales', 'front raise', 'frontales'], targets: ['elevacion frontal', 'front raise'] },
  { terms: ['apertura', 'aperturas', 'fly', 'flyes', 'flies', 'cristos'], targets: ['apertura', 'fly'] },
  { terms: ['press frances', 'frances', 'skull crusher', 'skullcrusher', 'rompecraneos'], targets: ['press frances', 'skull crusher', 'rompecraneos'] },
  { terms: ['patada de triceps', 'patada', 'kickback'], targets: ['patada', 'kickback'] },
  { terms: ['extension de triceps', 'triceps extension', 'copa'], targets: ['extension de triceps', 'triceps extension'] },
  { terms: ['prensa', 'leg press', 'prensa de piernas'], targets: ['prensa', 'leg press'] },
  { terms: ['extension de cuadriceps', 'extension de piernas', 'leg extension', 'sillon de cuadriceps'], targets: ['extension de piernas', 'leg extension'] },
  { terms: ['curl femoral', 'leg curl', 'curl de piernas'], targets: ['curl femoral', 'leg curl'] },
  { terms: ['pantorrilla', 'gemelo', 'gemelos', 'calf raise', 'calf', 'elevacion de talones', 'talones'], targets: ['pantorrilla', 'gemelo', 'calf', 'talon'] },
  { terms: ['encogimiento', 'shrug'], targets: ['encogimiento', 'shrug'] },
  { terms: ['pullover', 'pull over'], targets: ['pullover'] },
  { terms: ['buenos dias', 'good morning'], targets: ['buenos dias', 'good morning'] },
  { terms: ['martillo', 'hammer'], targets: ['martillo', 'hammer'] },
  { terms: ['predicador', 'preacher', 'scott', 'banco scott'], targets: ['predicador', 'preacher'] },
  { terms: ['pec deck', 'peck deck', 'contractora', 'mariposa', 'butterfly'], targets: ['pec deck', 'contractora', 'butterfly', 'mariposa'] },
  { terms: ['bulgara', 'bulgarian', 'sentadilla bulgara'], targets: ['bulgara', 'bulgarian', 'split squat'] },
  { terms: ['cargada', 'clean'], targets: ['cargada', 'clean'] },
  { terms: ['arrancada', 'arranque', 'snatch'], targets: ['arrancada', 'snatch'] },
  { terms: ['elevacion de piernas', 'leg raise', 'elevaciones de piernas'], targets: ['elevacion de piernas', 'leg raise'] },
  { terms: ['escalador', 'escaladores', 'mountain climber'], targets: ['escalador', 'mountain climber'] },
  { terms: ['rueda abdominal', 'ab wheel', 'ab roller', 'rueda'], targets: ['rueda', 'wheel', 'roller'] },
  { terms: ['giro ruso', 'giros rusos', 'russian twist'], targets: ['giro ruso', 'russian twist'] },
  { terms: ['subida al cajon', 'step up', 'stepup'], targets: ['subida al cajon', 'step up'] },
  { terms: ['salto al cajon', 'box jump'], targets: ['salto al cajon', 'box jump'] },
  { terms: ['balanceo', 'swing', 'kettlebell swing'], targets: ['balanceo', 'swing'] },
  { terms: ['saltar cuerda', 'saltar la cuerda', 'comba', 'jump rope', 'cuerda para saltar'], targets: ['jump rope', 'saltar la cuerda', 'cuerda'] },
  { terms: ['correr', 'trote', 'trotar', 'run', 'running'], targets: ['run', 'correr', 'carrera'] },
  { terms: ['bici', 'bicicleta', 'bike', 'cycling', 'spinning'], targets: ['bike', 'bicicleta', 'cycling'] },
  { terms: ['burpee', 'burpees'], targets: ['burpee'] },
  // ── Material
  { terms: ['mancuerna', 'dumbbell', 'pesas', 'pesa'], targets: ['mancuerna', 'dumbbell'] },
  { terms: ['barra', 'barbell'], targets: ['barra', 'barbell'] },
  { terms: ['polea', 'cable'], targets: ['polea', 'cable'] },
  { terms: ['maquina', 'machine', 'lever'], targets: ['maquina', 'machine', 'lever'] },
  { terms: ['smith', 'multipower', 'multifuerza'], targets: ['smith'] },
  { terms: ['banda', 'liga', 'elastico', 'band', 'goma'], targets: ['banda', 'band'] },
  { terms: ['kettlebell', 'pesa rusa', 'kb'], targets: ['kettlebell'] },
  { terms: ['peso corporal', 'sin equipo', 'sin material', 'bodyweight', 'body weight', 'calistenia'], targets: ['peso corporal', 'body weight', 'bodyweight'] },
  { terms: ['balon', 'pelota', 'ball', 'fitball'], targets: ['balon', 'ball'] },
  { terms: ['trx', 'suspension'], targets: ['suspension', 'suspended', 'trx'] },
  { terms: ['barra z', 'ez', 'barra ez'], targets: ['barra z', 'ez bar', 'ez barbell'] },
  { terms: ['banco'], targets: ['banco', 'bench'] },
  // ── Músculos y zonas
  { terms: ['pecho', 'pectoral', 'pectorales', 'chest'], targets: ['pecho', 'pectoral', 'chest'] },
  { terms: ['espalda', 'back', 'dorsal', 'dorsales', 'lats'], targets: ['espalda', 'back', 'dorsal', 'lats', 'latissimus'] },
  { terms: ['hombro', 'deltoides', 'deltoide', 'delts', 'shoulder'], targets: ['hombro', 'deltoide', 'delts', 'shoulder'] },
  { terms: ['biceps', 'bicep'], targets: ['biceps'] },
  { terms: ['triceps', 'tricep'], targets: ['triceps'] },
  { terms: ['antebrazo', 'forearm'], targets: ['antebrazo', 'forearm'] },
  { terms: ['brazo', 'arm'], targets: ['brazo', 'upper arms', 'lower arms'] },
  { terms: ['pierna', 'leg'], targets: ['pierna', 'upper legs', 'lower legs'] },
  { terms: ['cuadriceps', 'cuadricep', 'quads', 'quadriceps'], targets: ['cuadriceps', 'quads', 'quadriceps'] },
  { terms: ['isquios', 'isquiotibiales', 'isquiotibial', 'femorales', 'femoral', 'hamstrings'], targets: ['isquiotibial', 'hamstrings', 'femoral'] },
  { terms: ['gluteo', 'glutes', 'glute', 'pompis', 'nalgas'], targets: ['gluteo', 'glutes'] },
  { terms: ['core', 'zona media'], targets: ['core', 'abs', 'waist', 'abdominal'] },
  { terms: ['oblicuo', 'obliques'], targets: ['oblicuo', 'obliques'] },
  { terms: ['trapecio', 'traps', 'trapezius'], targets: ['trapecio', 'traps', 'trapezius'] },
  { terms: ['lumbar', 'lumbares', 'espalda baja', 'lower back'], targets: ['lumbar', 'lower back', 'spine', 'espalda baja'] },
  { terms: ['cuello', 'neck'], targets: ['cuello', 'neck'] },
  { terms: ['aductor', 'adductors'], targets: ['aductor', 'adductors'] },
  { terms: ['abductor', 'abductors'], targets: ['abductor', 'abductors'] },
  { terms: ['cardio'], targets: ['cardio', 'cardiovascular'] },
];
