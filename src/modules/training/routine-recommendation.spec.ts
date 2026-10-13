import { TrainingGoal } from '../../common/enums/domain.enums';
import { selectRoutineExercises, RecommendationExercise } from './routine-recommendation';

const catalogue: RecommendationExercise[] = [
  { id: 'press', name: 'Press de banca con mancuernas', muscleGroup: 'Pecho', bodyPart: 'Chest', targetMuscle: 'Pectorals', requiredEquipment: 'dumbbell' },
  { id: 'pushup', name: 'Flexiones', muscleGroup: 'Pecho', bodyPart: 'Chest', targetMuscle: 'Pectorals', requiredEquipment: 'body weight' },
  { id: 'row', name: 'Remo con mancuernas', muscleGroup: 'Espalda', bodyPart: 'Back', targetMuscle: 'Lats', requiredEquipment: 'dumbbell' },
  { id: 'squat', name: 'Sentadilla goblet', muscleGroup: 'Cuádriceps', bodyPart: 'Upper legs', targetMuscle: 'Quads', requiredEquipment: 'dumbbell' },
  { id: 'hinge', name: 'Hip thrust', muscleGroup: 'Glúteos', bodyPart: 'Upper legs', targetMuscle: 'Glutes', requiredEquipment: 'body weight' },
  { id: 'core', name: 'Plancha', muscleGroup: 'Abdominales', bodyPart: 'Waist', targetMuscle: 'Abs', requiredEquipment: 'body weight' },
  { id: 'snatch', name: 'Barbell snatch', muscleGroup: 'Espalda', bodyPart: 'Back', targetMuscle: 'Lats', requiredEquipment: 'barbell' },
];

describe('selectRoutineExercises', () => {
  it('covers movement patterns and puts leg work first for strength', () => {
    const result = selectRoutineExercises(catalogue, {
      goal: TrainingGoal.STRENGTH, location: 'GYM', equipment: [], minutes: 60, beginner: true,
    });
    expect(result.map((item) => item.exercise.id)).toEqual(['squat', 'hinge', 'press', 'row', 'core']);
    expect(result[0].repsMin).toBe(4);
  });

  it('does not suggest a bench exercise at home without a bench', () => {
    const result = selectRoutineExercises(catalogue, {
      goal: TrainingGoal.HYPERTROPHY, location: 'HOME', equipment: ['Mancuernas'], minutes: 60, beginner: true,
    });
    expect(result.map((item) => item.exercise.id)).not.toContain('press');
    expect(result.map((item) => item.exercise.id)).toContain('pushup');
  });

  it('never picks advanced lifts for a beginner', () => {
    const result = selectRoutineExercises(catalogue, {
      goal: TrainingGoal.STRENGTH, location: 'GYM', equipment: [], minutes: 90, beginner: true,
    });
    expect(result.map((item) => item.exercise.id)).not.toContain('snatch');
  });
});
