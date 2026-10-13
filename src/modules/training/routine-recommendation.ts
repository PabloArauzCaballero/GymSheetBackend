import { TrainingGoal } from '../../common/enums/domain.enums';

export type RecommendationExercise = {
  id: string;
  name: string;
  muscleGroup: string;
  bodyPart: string | null;
  targetMuscle: string | null;
  requiredEquipment: string | null;
};

export type RecommendedEntry<T> = {
  exercise: T;
  reason: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
};

type Pattern = 'push' | 'pull' | 'squat' | 'hinge' | 'core';
const patterns: Pattern[] = ['push', 'pull', 'squat', 'hinge', 'core'];
const patternReason: Record<Pattern, string> = {
  push: 'Empuje del tren superior',
  pull: 'Tracción del tren superior',
  squat: 'Trabajo dominante de rodilla',
  hinge: 'Trabajo de cadera y cadena posterior',
  core: 'Estabilidad del tronco',
};

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
}

function patternFor(exercise: RecommendationExercise): Pattern | null {
  const label = normalized([exercise.name, exercise.muscleGroup, exercise.bodyPart, exercise.targetMuscle].filter(Boolean).join(' '));
  if (/abdom|core|trunk|oblique|plank|plancha/.test(label)) return 'core';
  if (/hamstring|isquio|glute|peso muerto|deadlift|hip thrust|bisagra/.test(label)) return 'hinge';
  if (/quad|cuadricep|squat|sentadilla|prensa|lunge|zancada|upper leg/.test(label)) return 'squat';
  if (/back|espalda|dorsal|latiss|row|remo|pull|jalon|bicep/.test(label)) return 'pull';
  if (/chest|pecho|pectoral|press|push|tricep|shoulder|hombro|deltoid/.test(label)) return 'push';
  return null;
}

function equipmentFits(exercise: RecommendationExercise, location: string, equipment: string[]): boolean {
  if (location === 'GYM') return true;
  const owned = normalized(equipment.join(' '));
  const needed = normalized(exercise.requiredEquipment ?? '');
  const name = normalized(exercise.name);
  if (/machine|maquina|smith|cable|polea/.test(needed + ' ' + name)) {
    if (/cable|polea/.test(needed + ' ' + name)) return /polea/.test(owned);
    return /maquina/.test(owned);
  }
  if (/barbell|barra|plate|disco/.test(needed) && !/barra/.test(owned)) return false;
  if (/dumbbell|mancuerna/.test(needed) && !/mancuerna/.test(owned)) return false;
  if (/band|banda/.test(needed) && !/banda/.test(owned)) return false;
  if (/bench|banco|banca/.test(needed + ' ' + name) && !/banco/.test(owned)) return false;
  if (needed === '') return /body.?weight|peso corporal|plank|plancha|flexion|sentadilla libre/.test(name);
  return /none|body.?weight|peso corporal|calisthenic|barbell|barra|dumbbell|mancuerna|band|banda|bench|banco/.test(needed);
}

function score(exercise: RecommendationExercise, goal: TrainingGoal, beginner: boolean): number {
  const name = normalized(exercise.name);
  let value = 0;
  if (/press|sentadilla|squat|remo|row|jalon|pulldown|peso muerto|deadlift|hip thrust/.test(name)) value += 5;
  if (goal === TrainingGoal.STRENGTH && /barra|barbell|press|squat|sentadilla|deadlift|peso muerto/.test(name)) value += 4;
  if (goal === TrainingGoal.HYPERTROPHY && /mancuerna|dumbbell|maquina|machine|polea|cable/.test(name)) value += 2;
  if (beginner && /maquina|machine|mancuerna|dumbbell|goblet|sentado|seated/.test(name)) value += 3;
  if (beginner && /snatch|clean|jerk|arrancada|cargada|envion|muscle up/.test(name)) value -= 100;
  return value;
}

export function selectRoutineExercises<T extends RecommendationExercise>(
  exercises: readonly T[],
  options: {
    goal: TrainingGoal;
    location: 'GYM' | 'HOME' | 'OUTDOORS';
    equipment: string[];
    minutes: number;
    beginner: boolean;
  },
): RecommendedEntry<T>[] {
  const maxExercises = options.minutes < 40 ? 4 : options.minutes < 70 ? 5 : 6;
  const candidates = exercises
    .filter((exercise) => equipmentFits(exercise, options.location, options.equipment))
    .filter((exercise) => patternFor(exercise) !== null)
    .filter((exercise) => !options.beginner || !/snatch|clean|jerk|arrancada|cargada|envion|muscle up/.test(normalized(exercise.name)))
    .sort((a, b) => score(b, options.goal, options.beginner) - score(a, options.goal, options.beginner) || a.name.localeCompare(b.name));
  const selected: RecommendedEntry<T>[] = [];
  const used = new Set<string>();
  const choose = (pattern: Pattern) => {
    const candidate = candidates.find((exercise) => patternFor(exercise) === pattern && !used.has(exercise.id));
    if (!candidate) return;
    used.add(candidate.id);
    const strength = options.goal === TrainingGoal.STRENGTH;
    const endurance = options.goal === TrainingGoal.ENDURANCE;
    const sport = options.goal === TrainingGoal.SPORT_PERFORMANCE;
    selected.push({
      exercise: candidate,
      reason: `${patternReason[pattern]} · ${strength ? 'priorizado para fuerza' : endurance ? 'resistencia muscular' : sport ? 'base general para tu deporte' : 'cobertura equilibrada'}`,
      targetSets: options.beginner ? 2 : 3,
      repsMin: strength ? 4 : endurance ? 12 : sport ? 6 : 8,
      repsMax: strength ? 6 : endurance ? 15 : sport ? 10 : 12,
      restSeconds: strength ? 150 : endurance ? 60 : sport ? 120 : 90,
    });
  };
  const order = options.goal === TrainingGoal.STRENGTH
    ? (['squat', 'hinge', 'push', 'pull', 'core'] as Pattern[])
    : patterns;
  for (const pattern of order) {
    if (selected.length >= maxExercises) break;
    choose(pattern);
  }
  if (selected.length < maxExercises && options.goal === TrainingGoal.HYPERTROPHY) {
    const extra = candidates.find((exercise) => !used.has(exercise.id) && ['push', 'pull', 'squat', 'hinge'].includes(patternFor(exercise) ?? ''));
    if (extra) {
      selected.push({
        exercise: extra,
        reason: 'Volumen adicional para hipertrofia',
        targetSets: options.beginner ? 2 : 3,
        repsMin: 8,
        repsMax: 12,
        restSeconds: 90,
      });
    }
  }
  return selected;
}
