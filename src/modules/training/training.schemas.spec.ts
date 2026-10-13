import { createCompleteRoutineSchema, listRoutinesSchema } from './training.schemas';

const exercise = {
  ejercicioId: '00000000-0000-4000-8000-000000000001',
  orden: 1,
  seriesObjetivo: 3,
  repsMin: 8,
  repsMax: 12,
};

describe('complete routine contract', () => {
  it('accepts a publishable routine with all its exercises', () => {
    const result = createCompleteRoutineSchema.parse({
      nombre: 'Empuje',
      visibilidad: 'PUBLIC',
      objetivo: 'HIPERTROFIA',
      creationKey: '00000000-0000-4000-8000-000000000002',
      ejercicios: [exercise],
    });
    expect(result.visibility).toBe('PUBLIC');
    expect(result.exercises[0].targetSets).toBe(3);
  });

  it('rejects empty or conflicting prescriptions before creating any row', () => {
    const base = {
      nombre: 'Empuje',
      creationKey: '00000000-0000-4000-8000-000000000002',
    };
    expect(createCompleteRoutineSchema.safeParse({ ...base, ejercicios: [] }).success).toBe(false);
    expect(createCompleteRoutineSchema.safeParse({ ...base, ejercicios: [exercise, exercise] }).success).toBe(false);
  });

  it('supports filtering the public catalogue by goal', () => {
    expect(listRoutinesSchema.parse({ scope: 'public', goal: 'FUERZA' })).toMatchObject({
      scope: 'public', goal: 'FUERZA',
    });
  });
});
