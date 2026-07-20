import { externalExerciseDatasetSchema } from './exercises-dataset.schemas';

const validRecord = {
  id: '0001',
  name: '3/4 sit-up',
  category: 'waist',
  body_part: 'waist',
  equipment: 'body weight',
  instructions: { en: 'Perform the exercise.', es: 'Realiza el ejercicio.' },
  instruction_steps: { en: ['Perform the exercise.'], es: ['Realiza el ejercicio.'] },
  muscle_group: 'hip flexors',
  secondary_muscles: ['lower back'],
  target: 'abs',
  media_id: '2gPfomN',
  image: 'images/0001-2gPfomN.jpg',
  gif_url: 'videos/0001-2gPfomN.gif',
  attribution: '© Gym visual — https://gymvisual.com/',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('externalExerciseDatasetSchema', () => {
  it('accepts a valid external dataset record', () => {
    const result = externalExerciseDatasetSchema.parse([validRecord]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('0001');
  });

  it('rejects duplicate external identifiers', () => {
    const result = externalExerciseDatasetSchema.safeParse([
      validRecord,
      { ...validRecord },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects unexpected properties to detect upstream contract drift', () => {
    const result = externalExerciseDatasetSchema.safeParse([
      { ...validRecord, unexpected: true },
    ]);
    expect(result.success).toBe(false);
  });
});
