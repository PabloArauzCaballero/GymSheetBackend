/**
 * Glosario REPP de nombres de ejercicio: español neutro de Latinoamérica.
 * Es la referencia con la que se tradujo `exercise-names-es.borrador.data.ts` y la
 * que usa el verificador (`scripts/verify-exercise-names-es.mjs`) para detectar
 * inglés residual. Mayúscula solo en la primera palabra: «Press de banca con barra».
 */
export type GlossaryEntry = { en: string; es: string; nota?: string };

export const EXERCISE_GLOSSARY: readonly GlossaryEntry[] = [
  // Material
  { en: 'barbell', es: 'barra' },
  { en: 'ez bar / ez barbell / sz bar', es: 'barra Z' },
  { en: 'olympic barbell', es: 'barra olímpica' },
  { en: 'trap bar', es: 'barra hexagonal' },
  { en: 'dumbbell(s)', es: 'mancuerna(s)', nota: 'singular si el ejercicio es a un brazo' },
  { en: 'cable', es: 'polea', nota: '«en polea»; «con cuerda» / «con barra en V» para el agarre' },
  { en: 'kettlebell', es: 'kettlebell', nota: 'DECISIÓN: se conserva el anglicismo (ya usado en los 343 nombres revisados); «pesa rusa» queda como sinónimo no usado' },
  { en: 'band / resistance band', es: 'banda' },
  { en: 'lever / machine / sled', es: 'máquina' },
  { en: 'smith (machine)', es: 'máquina Smith' },
  { en: 'medicine ball', es: 'balón medicinal' },
  { en: 'stability / exercise ball', es: 'balón de estabilidad' },
  { en: 'bosu ball', es: 'Bosu' },
  { en: 'roller', es: 'rodillo' },
  { en: 'suspended (TRX)', es: 'en suspensión (TRX)' },
  { en: 'weighted', es: 'con lastre' },
  { en: 'bodyweight', es: 'peso corporal' },
  { en: 'bench', es: 'banco' },
  // Movimientos
  { en: 'bench press', es: 'press de banca' },
  { en: 'shoulder / military / overhead press', es: 'press de hombros / militar' },
  { en: 'row', es: 'remo' },
  { en: 'squat', es: 'sentadilla' },
  { en: 'lunge', es: 'zancada' },
  { en: 'deadlift', es: 'peso muerto' },
  { en: 'curl', es: 'curl', nota: 'anglicismo aceptado (curl de bíceps, curl martillo, curl predicador)' },
  { en: 'raise', es: 'elevación' },
  { en: 'fly', es: 'aperturas' },
  { en: 'pullover', es: 'pullover' },
  { en: 'pulldown / lat pulldown', es: 'jalón' },
  { en: 'pull-up / chin-up', es: 'dominada / dominada supina' },
  { en: 'push-up', es: 'flexión de brazos' },
  { en: 'sit-up / crunch', es: 'abdominal / crunch' },
  { en: 'dip', es: 'fondos' },
  { en: 'extension', es: 'extensión' },
  { en: 'kickback', es: 'patada (de tríceps)' },
  { en: 'shrug', es: 'encogimientos de hombros' },
  { en: 'twist', es: 'giro' },
  { en: 'side bend', es: 'flexión lateral de tronco' },
  { en: 'calf raise', es: 'elevación de talones' },
  { en: 'stretch', es: 'estiramiento' },
  { en: 'plank / bridge', es: 'plancha / puente' },
  { en: 'jump', es: 'salto' },
  { en: 'step-up', es: 'subida al cajón' },
  { en: 'good morning', es: 'buenos días' },
  // Posición, agarre, lateralidad
  { en: 'seated', es: 'sentado' },
  { en: 'standing', es: 'de pie' },
  { en: 'lying / supine', es: 'tumbado / boca arriba' },
  { en: 'prone', es: 'boca abajo' },
  { en: 'kneeling', es: 'arrodillado' },
  { en: 'hanging', es: 'colgado' },
  { en: 'incline / decline', es: 'inclinado / declinado' },
  { en: 'one arm / one leg', es: 'a un brazo / a una pierna' },
  { en: 'alternate / alternating', es: 'alterno' },
  { en: 'wide grip', es: 'agarre abierto' },
  { en: 'close / narrow grip', es: 'agarre cerrado / estrecho' },
  { en: 'reverse / underhand grip', es: 'agarre supino' },
  { en: 'overhand / pronated grip', es: 'agarre prono' },
  { en: 'neutral / parallel / hammer grip', es: 'agarre neutro' },
  { en: 'male / female (modelo del vídeo)', es: '(hombre) / (mujer)', nota: 'solo se conserva para distinguir duplicados' },
  { en: 'v. 2 / v. 3', es: '(variante 2) / (variante 3)' },
];

/** Préstamos y nombres propios que SÍ pueden aparecer en un nombre en español. */
export const ALLOWED_LOANWORDS: readonly string[] = [
  'curl', 'press', 'pullover', 'swing', 'burpee', 'burpees', 'kettlebell', 'kettlebells', 'smith', 'bosu', 'trx',
  'arnold', 'zottman', 'scott', 'tate', 'svend', 'jm', 'hack', 'thruster', 'landmine', 'face', 'pull', 'muscle',
  'up', 'front', 'back', 'lever', 'planche', 'maltesa', 'flag', 'skin', 'cat', 'elevator', 'inchworm', 'cocoons',
  'body', 'bottoms', 'otis', 'hyght', 'gironda', 'janda', 'bradford', 'rocky', 'jefferson', 'zercher', 'cossack',
  'thibaudeau', 'pallof', 'pistol', 'blaster', 'arm', 'straddle', 'dead', 'bug', 'goblet', 'kipping', 'power',
  'point', 'breeding', 'curl-up', 'l', 'v', 'w', 'y', 't', 'z', 'x',
];

/**
 * Palabras inglesas del glosario que NO deben quedar en un nombre en español
 * (el verificador las busca como palabra completa, sin distinguir mayúsculas).
 */
export const FORBIDDEN_ENGLISH_TOKENS: readonly string[] = [
  'barbell', 'dumbbell', 'dumbbells', 'cable', 'band', 'machine', 'sled', 'weighted', 'bodyweight', 'bench',
  'row', 'squat', 'lunge', 'deadlift', 'raise', 'raises', 'extension', 'stretch', 'push-up', 'pull-up', 'sit-up',
  'chin-up', 'dip', 'dips', 'seated', 'standing', 'lying', 'prone', 'kneeling', 'hanging', 'incline', 'decline',
  'grip', 'wide', 'close', 'narrow', 'reverse', 'alternate', 'alternating', 'one', 'single', 'with', 'the', 'and',
  'on', 'to', 'from', 'over', 'behind', 'side', 'leg', 'legs', 'knee', 'knees', 'twist', 'twisting', 'shrug',
  'kickback', 'pulldown', 'plank', 'bridge', 'jump', 'step', 'pov', 'male', 'female', 'assisted', 'suspended',
];
