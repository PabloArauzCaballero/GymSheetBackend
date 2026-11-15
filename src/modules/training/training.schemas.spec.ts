import { createCompleteRoutineSchema, isLegacyRoutineListQuery, listRoutinesSchema } from './training.schemas';

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

describe('GET /routines · legacy page vs. cursor catalog', () => {
  it('keeps installed apps on the page-based list, including mobile «Explorar rutinas»', () => {
    expect(isLegacyRoutineListQuery({})).toBe(true);
    expect(isLegacyRoutineListQuery({ scope: 'mine', pageSize: '100' })).toBe(true);
    expect(isLegacyRoutineListQuery({ scope: 'templates' })).toBe(true);
    expect(isLegacyRoutineListQuery({ scope: 'public', pageSize: '20', page: '1' })).toBe(true);
    expect(isLegacyRoutineListQuery({ scope: 'public', pageSize: '20', page: '2', goal: 'FUERZA' })).toBe(true);
  });

  it('routes catalog requests (limit, cursor or a bare public scope) to the cursor catalog', () => {
    expect(isLegacyRoutineListQuery({ scope: 'public' })).toBe(false);
    expect(isLegacyRoutineListQuery({ scope: 'public', q: 'x', objetivo: 'FUERZA' })).toBe(false);
    expect(isLegacyRoutineListQuery({ scope: 'public', page: '1', limit: '20' })).toBe(false);
    expect(isLegacyRoutineListQuery({ scope: 'mine', limit: '20' })).toBe(false);
    expect(isLegacyRoutineListQuery({ scope: 'mine', cursor: 'abc' })).toBe(false);
    expect(isLegacyRoutineListQuery({ scope: 'all' })).toBe(false);
  });

  it('any catalog-only filter wins over page/pageSize, so no filter is dropped silently', () => {
    const page = { scope: 'public', page: '2', pageSize: '20' };
    for (const [param, value] of [
      ['q', 'x'], ['objetivo', 'FUERZA'], ['diasPorSemana', '3'], ['orden', 'valoradas'],
      ['deMiGimnasio', 'true'], ['limit', '20'], ['cursor', 'abc'],
    ]) {
      expect(isLegacyRoutineListQuery({ ...page, [param]: value })).toBe(false);
      expect(isLegacyRoutineListQuery({ scope: 'mine', pageSize: '100', [param]: value })).toBe(false);
    }
    expect(isLegacyRoutineListQuery({ scope: 'public', page: '2', q: 'x', objetivo: 'FUERZA' })).toBe(false);
  });

  it('the legacy list validates its own params: pageSize ≤ 100 and a known goal', () => {
    expect(listRoutinesSchema.safeParse({ scope: 'public', pageSize: '101' }).success).toBe(false);
    expect(listRoutinesSchema.safeParse({ scope: 'public', goal: 'INVALID' }).success).toBe(false);
    expect(listRoutinesSchema.parse({ scope: 'public', page: '2', pageSize: '20', goal: 'FUERZA' })).toEqual({
      scope: 'public', page: 2, pageSize: 20, goal: 'FUERZA',
    });
  });
});
