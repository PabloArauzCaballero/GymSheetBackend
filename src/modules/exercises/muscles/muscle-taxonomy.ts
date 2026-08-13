/**
 * Taxonomía anatómica de músculos y grupos musculares.
 *
 * Fuente: anatomía estándar (nomenclatura latina) + normalización de las
 * etiquetas reales presentes en el catálogo (`grupo_muscular`, `target_muscle`,
 * `secondary_muscles`) y en el dataset abierto free-exercise-db
 * (`primaryMuscles`/`secondaryMuscles`). No inventa relaciones: cada alias
 * proviene de un valor observado en los datos.
 *
 * Dos niveles: `muscleGroups` (regiones para recomendaciones) y `muscles`
 * (músculos específicos, cada uno en un grupo).
 */

export interface MuscleGroupSeed {
  readonly code: string;
  readonly name: string;
  readonly region: "UPPER" | "CORE" | "LOWER" | "SYSTEMIC";
  readonly description: string;
}

export interface MuscleSeed {
  readonly code: string;
  readonly name: string;
  readonly latinName: string;
  readonly groupCode: string;
  readonly description: string;
}

export const muscleGroups: readonly MuscleGroupSeed[] = [
  { code: "CHEST", name: "Pecho", region: "UPPER", description: "Musculatura pectoral: empujes horizontales y aducción del hombro." },
  { code: "BACK", name: "Espalda", region: "UPPER", description: "Dorsales, trapecio, romboides y erectores: tracciones y extensión de columna." },
  { code: "SHOULDERS", name: "Hombros", region: "UPPER", description: "Deltoides y estabilizadores del manguito rotador." },
  { code: "ARMS", name: "Brazos", region: "UPPER", description: "Bíceps, tríceps y antebrazos: flexión/extensión de codo y muñeca." },
  { code: "CORE", name: "Core / Abdomen", region: "CORE", description: "Recto abdominal, oblicuos, transverso y flexores de cadera: estabilización del tronco." },
  { code: "LEGS", name: "Piernas", region: "LOWER", description: "Cuádriceps, isquiotibiales, aductores y tibial: motor del tren inferior." },
  { code: "GLUTES", name: "Glúteos", region: "LOWER", description: "Glúteo mayor y medio: extensión y abducción de cadera." },
  { code: "CALVES", name: "Pantorrillas", region: "LOWER", description: "Gastrocnemio y sóleo: flexión plantar del tobillo." },
  { code: "NECK", name: "Cuello", region: "UPPER", description: "Musculatura cervical." },
  { code: "CARDIO", name: "Sistémico / Cardiovascular", region: "SYSTEMIC", description: "Demanda cardiovascular y metabólica sistémica." },
];

export const muscles: readonly MuscleSeed[] = [
  // CHEST
  { code: "PECTORALIS_MAJOR", name: "Pectoral mayor", latinName: "Pectoralis major", groupCode: "CHEST", description: "Principal motor del empuje horizontal y la aducción del húmero." },
  { code: "PECTORALIS_MINOR", name: "Pectoral menor", latinName: "Pectoralis minor", groupCode: "CHEST", description: "Estabiliza y bascula la escápula." },
  { code: "SERRATUS_ANTERIOR", name: "Serrato anterior", latinName: "Serratus anterior", groupCode: "CHEST", description: "Protracción y rotación ascendente de la escápula." },
  // BACK
  { code: "LATISSIMUS_DORSI", name: "Dorsal ancho", latinName: "Latissimus dorsi", groupCode: "BACK", description: "Aducción, extensión y rotación interna del hombro; tracciones verticales." },
  { code: "TRAPEZIUS", name: "Trapecio", latinName: "Trapezius", groupCode: "BACK", description: "Eleva, retrae y rota la escápula." },
  { code: "RHOMBOIDS", name: "Romboides", latinName: "Rhomboidei", groupCode: "BACK", description: "Retracción escapular; espalda media." },
  { code: "ERECTOR_SPINAE", name: "Erectores espinales", latinName: "Erector spinae", groupCode: "BACK", description: "Extensión y estabilización de la columna; zona lumbar." },
  { code: "TERES_MAJOR", name: "Redondo mayor", latinName: "Teres major", groupCode: "BACK", description: "Asiste al dorsal en la aducción y rotación interna." },
  { code: "INFRASPINATUS", name: "Infraespinoso", latinName: "Infraspinatus", groupCode: "BACK", description: "Rotación externa del hombro (manguito rotador)." },
  // SHOULDERS
  { code: "DELTOID", name: "Deltoides", latinName: "Deltoideus", groupCode: "SHOULDERS", description: "Abducción y flexión del hombro (tres fascículos)." },
  { code: "DELTOID_ANTERIOR", name: "Deltoides anterior", latinName: "Deltoideus pars clavicularis", groupCode: "SHOULDERS", description: "Flexión y rotación interna del hombro." },
  { code: "DELTOID_LATERAL", name: "Deltoides lateral", latinName: "Deltoideus pars acromialis", groupCode: "SHOULDERS", description: "Abducción del hombro." },
  { code: "DELTOID_POSTERIOR", name: "Deltoides posterior", latinName: "Deltoideus pars spinalis", groupCode: "SHOULDERS", description: "Extensión y rotación externa del hombro." },
  { code: "ROTATOR_CUFF", name: "Manguito rotador", latinName: "Musculi rotatores", groupCode: "SHOULDERS", description: "Estabilización de la articulación glenohumeral." },
  { code: "LEVATOR_SCAPULAE", name: "Elevador de la escápula", latinName: "Levator scapulae", groupCode: "SHOULDERS", description: "Eleva la escápula; cuello-hombro." },
  // ARMS
  { code: "BICEPS_BRACHII", name: "Bíceps braquial", latinName: "Biceps brachii", groupCode: "ARMS", description: "Flexión del codo y supinación del antebrazo." },
  { code: "BRACHIALIS", name: "Braquial anterior", latinName: "Brachialis", groupCode: "ARMS", description: "Flexor puro del codo." },
  { code: "BRACHIORADIALIS", name: "Braquiorradial", latinName: "Brachioradialis", groupCode: "ARMS", description: "Flexión del codo en posición neutra." },
  { code: "TRICEPS_BRACHII", name: "Tríceps braquial", latinName: "Triceps brachii", groupCode: "ARMS", description: "Extensión del codo." },
  { code: "FOREARM_FLEXORS", name: "Flexores del antebrazo", latinName: "Flexores antebrachii", groupCode: "ARMS", description: "Flexión de muñeca y dedos; agarre." },
  { code: "FOREARM_EXTENSORS", name: "Extensores del antebrazo", latinName: "Extensores antebrachii", groupCode: "ARMS", description: "Extensión de muñeca y dedos." },
  // CORE
  { code: "RECTUS_ABDOMINIS", name: "Recto abdominal", latinName: "Rectus abdominis", groupCode: "CORE", description: "Flexión del tronco; estabilización." },
  { code: "OBLIQUES", name: "Oblicuos", latinName: "Obliquus externus et internus", groupCode: "CORE", description: "Rotación e inclinación lateral del tronco." },
  { code: "TRANSVERSE_ABDOMINIS", name: "Transverso abdominal", latinName: "Transversus abdominis", groupCode: "CORE", description: "Faja abdominal profunda; presión intraabdominal." },
  { code: "HIP_FLEXORS", name: "Flexores de cadera", latinName: "Iliopsoas", groupCode: "CORE", description: "Flexión de cadera; psoas ilíaco." },
  // LEGS
  { code: "QUADRICEPS", name: "Cuádriceps", latinName: "Quadriceps femoris", groupCode: "LEGS", description: "Extensión de rodilla." },
  { code: "HAMSTRINGS", name: "Isquiotibiales", latinName: "Musculi ischiocrurales", groupCode: "LEGS", description: "Flexión de rodilla y extensión de cadera." },
  { code: "ADDUCTORS", name: "Aductores", latinName: "Musculi adductores", groupCode: "LEGS", description: "Aducción de cadera." },
  { code: "ABDUCTORS", name: "Abductores de cadera", latinName: "Gluteus medius et minimus", groupCode: "LEGS", description: "Abducción y estabilización de cadera." },
  { code: "TIBIALIS_ANTERIOR", name: "Tibial anterior", latinName: "Tibialis anterior", groupCode: "LEGS", description: "Dorsiflexión del tobillo; estabilidad." },
  // GLUTES
  { code: "GLUTEUS_MAXIMUS", name: "Glúteo mayor", latinName: "Gluteus maximus", groupCode: "GLUTES", description: "Extensión y rotación externa de cadera." },
  { code: "GLUTEUS_MEDIUS", name: "Glúteo medio", latinName: "Gluteus medius", groupCode: "GLUTES", description: "Abducción y estabilización pélvica." },
  // CALVES
  { code: "GASTROCNEMIUS", name: "Gastrocnemio", latinName: "Gastrocnemius", groupCode: "CALVES", description: "Flexión plantar con rodilla extendida." },
  { code: "SOLEUS", name: "Sóleo", latinName: "Soleus", groupCode: "CALVES", description: "Flexión plantar con rodilla flexionada." },
  // NECK
  { code: "STERNOCLEIDOMASTOID", name: "Esternocleidomastoideo", latinName: "Sternocleidomastoideus", groupCode: "NECK", description: "Flexión y rotación del cuello." },
  // CARDIO
  { code: "CARDIOVASCULAR", name: "Sistema cardiovascular", latinName: "Systema cardiovasculare", groupCode: "CARDIO", description: "Demanda aeróbica/anaeróbica sistémica." },
];

/** Alias observados en los datos → código de músculo canónico. */
const muscleAliases: Readonly<Record<string, string>> = {
  // chest
  chest: "PECTORALIS_MAJOR", pecho: "PECTORALIS_MAJOR", pectorals: "PECTORALIS_MAJOR",
  pectoral: "PECTORALIS_MAJOR", pectoralis: "PECTORALIS_MAJOR", "pectoralis major": "PECTORALIS_MAJOR",
  "pectoralis minor": "PECTORALIS_MINOR", "serratus anterior": "SERRATUS_ANTERIOR", serratus: "SERRATUS_ANTERIOR",
  // back
  lats: "LATISSIMUS_DORSI", lat: "LATISSIMUS_DORSI", "latissimus dorsi": "LATISSIMUS_DORSI", dorsal: "LATISSIMUS_DORSI",
  traps: "TRAPEZIUS", trapezius: "TRAPEZIUS", trapecio: "TRAPEZIUS", "upper back": "TRAPEZIUS",
  "middle back": "RHOMBOIDS", rhomboids: "RHOMBOIDS", romboides: "RHOMBOIDS",
  "lower back": "ERECTOR_SPINAE", spine: "ERECTOR_SPINAE", erector: "ERECTOR_SPINAE",
  "erector spinae": "ERECTOR_SPINAE", lumbar: "ERECTOR_SPINAE",
  "teres major": "TERES_MAJOR", infraspinatus: "INFRASPINATUS",
  // shoulders
  shoulders: "DELTOID", delts: "DELTOID", deltoids: "DELTOID", deltoid: "DELTOID", hombros: "DELTOID",
  "front delt": "DELTOID_ANTERIOR", "anterior deltoid": "DELTOID_ANTERIOR",
  "side delt": "DELTOID_LATERAL", "lateral deltoid": "DELTOID_LATERAL",
  "rear delt": "DELTOID_POSTERIOR", "posterior deltoid": "DELTOID_POSTERIOR",
  "rotator cuff": "ROTATOR_CUFF", manguito: "ROTATOR_CUFF",
  "levator scapulae": "LEVATOR_SCAPULAE",
  // arms
  biceps: "BICEPS_BRACHII", bicep: "BICEPS_BRACHII", brachialis: "BRACHIALIS",
  brachioradialis: "BRACHIORADIALIS", triceps: "TRICEPS_BRACHII",
  forearms: "FOREARM_FLEXORS", forearm: "FOREARM_FLEXORS", antebrazo: "FOREARM_FLEXORS",
  "wrist flexors": "FOREARM_FLEXORS", wrists: "FOREARM_FLEXORS", wrist: "FOREARM_FLEXORS", hands: "FOREARM_FLEXORS",
  "wrist extensors": "FOREARM_EXTENSORS",
  // core
  abs: "RECTUS_ABDOMINIS", abdominals: "RECTUS_ABDOMINIS", abdominal: "RECTUS_ABDOMINIS",
  abdomen: "RECTUS_ABDOMINIS", "rectus abdominis": "RECTUS_ABDOMINIS", core: "RECTUS_ABDOMINIS",
  obliques: "OBLIQUES", oblicuos: "OBLIQUES",
  "transverse abdominis": "TRANSVERSE_ABDOMINIS",
  "hip flexors": "HIP_FLEXORS", "hip flexor": "HIP_FLEXORS",
  // legs
  quads: "QUADRICEPS", quadriceps: "QUADRICEPS", cuadriceps: "QUADRICEPS",
  hamstrings: "HAMSTRINGS", hamstring: "HAMSTRINGS", isquiotibiales: "HAMSTRINGS",
  adductors: "ADDUCTORS", aductores: "ADDUCTORS",
  abductors: "ABDUCTORS", abductores: "ABDUCTORS",
  "tibialis anterior": "TIBIALIS_ANTERIOR", tibialis: "TIBIALIS_ANTERIOR",
  ankles: "TIBIALIS_ANTERIOR", "ankle stabilizers": "TIBIALIS_ANTERIOR", shins: "TIBIALIS_ANTERIOR",
  // glutes
  glutes: "GLUTEUS_MAXIMUS", gluteus: "GLUTEUS_MAXIMUS", "gluteus maximus": "GLUTEUS_MAXIMUS",
  gluteos: "GLUTEUS_MAXIMUS", gluteo: "GLUTEUS_MAXIMUS", buttocks: "GLUTEUS_MAXIMUS",
  "gluteus medius": "GLUTEUS_MEDIUS", "gluteo medio": "GLUTEUS_MEDIUS",
  // calves
  calves: "GASTROCNEMIUS", calf: "GASTROCNEMIUS", pantorrillas: "GASTROCNEMIUS",
  gastrocnemius: "GASTROCNEMIUS", soleus: "SOLEUS",
  // neck
  neck: "STERNOCLEIDOMASTOID", cuello: "STERNOCLEIDOMASTOID",
  // cardio
  "cardiovascular system": "CARDIOVASCULAR", cardiovascular: "CARDIOVASCULAR", cardio: "CARDIOVASCULAR",
};

const muscleCodes = new Set(muscles.map((m) => m.code));

/** Normaliza una etiqueta de músculo cruda a un código canónico, o null. */
export function normalizeMuscleLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return null;
  if (muscleAliases[key]) return muscleAliases[key];
  // permitir que un código canónico en minúsculas también resuelva
  const upper = key.toUpperCase().replace(/ /g, "_");
  return muscleCodes.has(upper) ? upper : null;
}

/** Devuelve el código de grupo del músculo, o null. */
export function groupOfMuscle(muscleCode: string): string | null {
  return muscles.find((m) => m.code === muscleCode)?.groupCode ?? null;
}
