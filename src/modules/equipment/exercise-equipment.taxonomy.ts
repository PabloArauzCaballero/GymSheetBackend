/**
 * De qué máquina habla un ejercicio.
 *
 * El usuario final no etiqueta equipamiento —no lo ve, no se le pregunta, y
 * pedírselo sería pedirle trabajo administrativo a cambio de nada—. Pero el
 * gimnasio sí necesita saber qué máquinas se usan: es de ahí de donde sale su
 * próxima compra y la decisión de mover una prensa de sala. Ese enlace tiene
 * que salir de algún sitio, y sale de aquí: se infiere del ejercicio.
 *
 * Dos fuentes, en este orden:
 *
 * 1. `required_equipment`, cuando el ejercicio viene del catálogo importado y
 *    trae el dato del origen. Es un dato declarado y gana siempre.
 * 2. El nombre del ejercicio, con reglas por palabra clave. Es lo único que hay
 *    para los ejercicios que el gimnasio escribe a mano.
 *
 * Las reglas son deliberadamente conservadoras: ante la duda, no se enlaza.
 * Un informe que dice «no lo sé» es corregible; uno que atribuye series a la
 * máquina equivocada lleva a comprar la máquina equivocada, y nadie va a
 * sospechar de él porque llegó con un número al lado.
 *
 * Por eso no se intenta adivinar entre variantes que compiten: «press de
 * banca» enlaza con el banco plano y la barra, no con la máquina de press de
 * pecho, porque el ejercicio con barra es el que ese nombre significa en un
 * gimnasio. Quien tenga la máquina y quiera distinguirlos puede editar el
 * ejercicio; lo que no puede es deshacer una atribución que nunca vio.
 */

/** Normaliza para comparar: sin acentos, sin mayúsculas, sin dobles espacios. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Vocabulario del catálogo importado. Los valores llegan en inglés y en varias
 * grafías («body weight», «bodyweight»), así que se comparan normalizados.
 */
const equipmentByDeclaredValue: ReadonlyMap<string, readonly string[]> = new Map(
  [
    ["barbell", ["barra-olimpica"]],
    ["olympic barbell", ["barra-olimpica"]],
    ["ez barbell", ["barra-z"]],
    ["ez bar", ["barra-z"]],
    ["dumbbell", ["mancuernas"]],
    ["dumbbells", ["mancuernas"]],
    ["kettlebell", ["kettlebell"]],
    ["weight plate", ["discos"]],
    ["plate", ["discos"]],
    ["cable", ["polea-doble"]],
    ["band", ["bandas"]],
    ["resistance band", ["bandas"]],
    ["medicine ball", ["balon-medicinal"]],
    ["stability ball", ["colchoneta"]],
    ["bosu ball", ["colchoneta"]],
    ["suspension", ["trx"]],
    ["trap bar", ["barra-olimpica"]],
    ["smith machine", ["jaula-potencia"]],
    ["leverage machine", ["remo-maquina"]],
    ["sled machine", ["prensa-piernas"]],
    ["stationary bike", ["bicicleta-estatica"]],
    ["elliptical machine", ["eliptica"]],
    ["stepmill machine", ["escaladora"]],
    ["skierg machine", ["remo-cardio"]],
    ["upper body ergometer", ["remo-cardio"]],
    ["rope", ["cuerda-batida"]],
    ["roller", ["colchoneta"]],
    ["hammer", ["remo-maquina"]],
    // «body weight» y «assisted» no enlazan con nada por sí solos: el peso
    // corporal no es una máquina, y «assisted» no dice cuál asiste. El nombre
    // del ejercicio decide.
  ].map(([key, claves]) => [normalizeForMatch(key as string), claves as string[]]),
);

interface NameRule {
  /** Todas deben aparecer en el nombre normalizado. */
  readonly incluye: readonly string[];
  /** Si alguna aparece, la regla no aplica. */
  readonly excluye?: readonly string[];
  readonly claves: readonly string[];
}

/**
 * Reglas por nombre. El orden importa: se aplican todas las que casen, y las
 * claves se acumulan sin repetir, porque un ejercicio usa de verdad más de una
 * cosa —un press de banca ocupa el banco y la barra—.
 */
const nameRules: readonly NameRule[] = [
  // Empuje horizontal.
  {
    incluye: ["press", "banca"],
    excluye: ["maquina", "multipower"],
    claves: ["banco-plano", "barra-olimpica"],
  },
  { incluye: ["press", "banca", "maquina"], claves: ["press-banca"] },
  { incluye: ["press", "inclinado"], claves: ["banco-inclinado", "barra-olimpica"] },
  { incluye: ["press", "declinado"], claves: ["banco-declinado", "barra-olimpica"] },
  { incluye: ["bench press"], claves: ["banco-plano", "barra-olimpica"] },
  { incluye: ["aperturas"], claves: ["banco-plano", "mancuernas"] },
  { incluye: ["contractor"], claves: ["peck-deck"] },
  { incluye: ["peck deck"], claves: ["peck-deck"] },
  { incluye: ["fondos"], claves: ["fondos-asistidos"] },

  // Empuje vertical.
  {
    incluye: ["press", "militar"],
    claves: ["barra-olimpica", "rack-sentadilla"],
  },
  { incluye: ["press", "hombro"], claves: ["press-hombro"] },
  { incluye: ["elevaciones", "laterales"], claves: ["mancuernas"] },

  // Tirón.
  { incluye: ["dominadas"], excluye: ["asistidas"], claves: ["barra-dominadas"] },
  { incluye: ["dominadas", "asistidas"], claves: ["dominadas-asistidas"] },
  { incluye: ["jalon"], claves: ["jalon-polea-alta"] },
  { incluye: ["remo", "barra"], claves: ["barra-olimpica"] },
  { incluye: ["remo", "polea"], claves: ["remo-sentado"] },
  { incluye: ["remo", "sentado"], claves: ["remo-sentado"] },
  { incluye: ["remo", "maquina"], claves: ["remo-maquina"] },
  { incluye: ["remo", "mancuerna"], claves: ["mancuernas", "banco-plano"] },
  { incluye: ["face pull"], claves: ["polea-doble"] },
  { incluye: ["encogimientos"], claves: ["mancuernas"] },

  // Pierna.
  {
    incluye: ["sentadilla"],
    excluye: ["hack", "bulgara", "goblet"],
    claves: ["rack-sentadilla", "barra-olimpica"],
  },
  { incluye: ["hack"], claves: ["hack-squat"] },
  { incluye: ["prensa"], claves: ["prensa-piernas"] },
  { incluye: ["leg press"], claves: ["prensa-piernas"] },
  { incluye: ["extension", "cuadriceps"], claves: ["extension-cuadriceps"] },
  { incluye: ["curl", "femoral"], claves: ["curl-femoral"] },
  { incluye: ["peso muerto"], claves: ["barra-olimpica", "discos"] },
  { incluye: ["hip thrust"], claves: ["hip-thrust"] },
  { incluye: ["gemelos"], claves: ["gemelos"] },
  { incluye: ["zancada"], claves: ["mancuernas"] },
  { incluye: ["abductores"], claves: ["abductores"] },
  { incluye: ["aductores"], claves: ["abductores"] },

  // Brazo.
  {
    incluye: ["curl", "biceps"],
    excluye: ["femoral"],
    claves: ["barra-z"],
  },
  { incluye: ["triceps", "polea"], claves: ["polea-doble"] },
  { incluye: ["extension", "triceps"], claves: ["polea-doble"] },

  // Cardio.
  { incluye: ["cinta"], claves: ["cinta"] },
  { incluye: ["correr"], claves: ["cinta"] },
  { incluye: ["eliptica"], claves: ["eliptica"] },
  { incluye: ["bicicleta"], claves: ["bicicleta-estatica"] },
  { incluye: ["escaladora"], claves: ["escaladora"] },

  // Funcional.
  { incluye: ["plancha"], claves: ["colchoneta"] },
  { incluye: ["abdominales"], claves: ["colchoneta"] },
  { incluye: ["cajon"], claves: ["cajon-pliometrico"] },
  { incluye: ["trx"], claves: ["trx"] },
  { incluye: ["banda"], claves: ["bandas"] },
];

/**
 * Claves de catálogo que corresponden a un ejercicio. Vacío significa «no se
 * sabe», y eso es una respuesta legítima: el informe agrupa por nombre de
 * ejercicio cuando no hay máquina, en vez de inventar una.
 */
export function resolveEquipmentClaves(
  exerciseName: string,
  declaredEquipment?: string | null,
): readonly string[] {
  const claves = new Set<string>();

  if (declaredEquipment) {
    const declared = equipmentByDeclaredValue.get(
      normalizeForMatch(declaredEquipment),
    );
    for (const clave of declared ?? []) claves.add(clave);
  }

  const name = normalizeForMatch(exerciseName);
  for (const rule of nameRules) {
    if (!rule.incluye.every((token) => name.includes(token))) continue;
    if (rule.excluye?.some((token) => name.includes(token))) continue;
    for (const clave of rule.claves) claves.add(clave);
  }

  return [...claves];
}
