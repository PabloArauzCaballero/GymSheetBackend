/**
 * Puntuación editorial (estrellas) de un ejercicio. Es una heurística
 * transparente y auditable derivada de atributos reales del ejercicio, NO un
 * valor aleatorio ni una afirmación médica. La preferencia subjetiva real de
 * cada persona se captura por separado (user_exercise_preferences).
 *
 * - `recommendedStars`: cuán recomendable como ejercicio de base (compuesto,
 *   accesible por equipamiento, funcional).
 * - `funStars`: cuán dinámico/entretenido tiende a ser.
 *
 * Los factores se devuelven para poder auditar y ajustar la fórmula.
 */
export interface ExerciseRatingInput {
  readonly category: string | null;
  readonly requiredEquipment: string | null;
  readonly primaryMuscleCount: number;
  readonly secondaryMuscleCount: number;
}

export interface ExerciseRating {
  readonly recommendedStars: number;
  readonly funStars: number;
  readonly factors: {
    readonly compound: number;
    readonly accessibility: number;
    readonly categoryValue: number;
    readonly dynamism: number;
    readonly recommendedRaw: number;
    readonly funRaw: number;
    readonly totalMuscles: number;
  };
}

function has(text: string | null, ...needles: string[]): boolean {
  if (!text) return false;
  const value = text.toLowerCase();
  return needles.some((needle) => value.includes(needle));
}

function toStars(raw: number): number {
  return Math.min(5, Math.max(1, Math.round(1 + raw * 4)));
}

function compoundScore(total: number): number {
  if (total >= 4) return 1;
  if (total === 3) return 0.8;
  if (total === 2) return 0.55;
  if (total === 1) return 0.3;
  return 0.15;
}

function accessibilityScore(equipment: string | null): number {
  if (has(equipment, "body only", "body weight", "bodyweight", "none", "sin equipo"))
    return 1;
  if (has(equipment, "dumbbell", "kettlebell", "band", "mancuerna", "pesa rusa", "banda"))
    return 0.85;
  if (has(equipment, "barbell", "cable", "barra", "polea", "e-z", "ez"))
    return 0.7;
  if (has(equipment, "machine", "máquina", "maquina", "smith")) return 0.5;
  return 0.55;
}

function categoryValueScore(category: string | null): number {
  if (has(category, "strength", "power", "strongman", "olympic", "fuerza"))
    return 1;
  if (has(category, "plyometric", "pliometr")) return 0.85;
  if (has(category, "cardio", "conditioning")) return 0.7;
  if (has(category, "stretch", "mobility", "estiramiento", "movilidad"))
    return 0.25;
  return 0.7;
}

function dynamismScore(category: string | null, total: number): number {
  if (has(category, "plyometric", "olympic", "cardio", "strongman", "pliometr"))
    return 1;
  if (has(category, "stretch", "mobility", "estiramiento", "movilidad"))
    return 0.3;
  if (total >= 3) return 0.75;
  return 0.55;
}

export function computeExerciseRating(input: ExerciseRatingInput): ExerciseRating {
  const totalMuscles = input.primaryMuscleCount + input.secondaryMuscleCount;
  const compound = compoundScore(totalMuscles);
  const accessibility = accessibilityScore(input.requiredEquipment);
  const categoryValue = categoryValueScore(input.category);
  const dynamism = dynamismScore(input.category, totalMuscles);

  const recommendedRaw =
    0.5 * compound + 0.2 * accessibility + 0.3 * categoryValue;
  const variety = totalMuscles >= 3 ? 0.8 : 0.5;
  const funRaw = 0.5 * dynamism + 0.3 * variety + 0.2 * accessibility;

  return {
    recommendedStars: toStars(recommendedRaw),
    funStars: toStars(funRaw),
    factors: {
      compound,
      accessibility,
      categoryValue,
      dynamism,
      recommendedRaw: Number(recommendedRaw.toFixed(3)),
      funRaw: Number(funRaw.toFixed(3)),
      totalMuscles,
    },
  };
}
