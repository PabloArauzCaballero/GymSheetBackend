import { diffAgainstRoutine, hasChanges, modalWeight, sessionBasePoints } from './session-diff';

const plan = (id: string, ex: string, sets = 3, kg: number | null = 60) => ({
  routineExerciseId: id,
  exerciseId: ex,
  targetSets: sets,
  targetWeightKg: kg,
});
const done = (ex: string, reps: number[], kg = 60) => ({ exerciseId: ex, sets: reps.map((r) => ({ reps: r, weightKg: kg })) });

describe('diffAgainstRoutine', () => {
  it('sin diferencias no propone nada', () => {
    const p = diffAgainstRoutine([plan('r1', 'a')], [done('a', [8, 8, 8])]);
    expect(hasChanges(p)).toBe(false);
  });
  it('propone el peso real cuando difiere del objetivo', () => {
    const p = diffAgainstRoutine([plan('r1', 'a')], [done('a', [8, 8, 8], 65)]);
    expect(p.cambios).toEqual([{ routineExerciseId: 'r1', pesoObjetivoKg: 65 }]);
  });
  it('propone el número real de series', () => {
    const p = diffAgainstRoutine([plan('r1', 'a')], [done('a', [8, 8, 8, 6])]);
    expect(p.cambios).toEqual([{ routineExerciseId: 'r1', seriesObjetivo: 4 }]);
  });
  it('si el objetivo no tenía peso, propone el usado', () => {
    const p = diffAgainstRoutine([plan('r1', 'a', 3, null)], [done('a', [8, 8, 8], 40)]);
    expect(p.cambios[0].pesoObjetivoKg).toBe(40);
  });
  it('un ejercicio nuevo se agrega con sus series y peso', () => {
    const p = diffAgainstRoutine([plan('r1', 'a')], [done('a', [8, 8, 8]), done('z', [10, 10], 20)]);
    expect(p.agregar).toEqual([{ ejercicioId: 'z', seriesObjetivo: 2, pesoObjetivoKg: 20 }]);
  });
  it('un ejercicio saltado se propone quitar', () => {
    const p = diffAgainstRoutine([plan('r1', 'a'), plan('r2', 'b')], [done('a', [8, 8, 8])]);
    expect(p.quitar).toEqual(['r2']);
  });
  it('una sesión sin ninguna serie no propone vaciar la rutina', () => {
    const p = diffAgainstRoutine([plan('r1', 'a')], []);
    expect(hasChanges(p)).toBe(false);
  });
  it('peso corporal (0 kg) no genera propuesta de peso', () => {
    const p = diffAgainstRoutine([plan('r1', 'a', 3, null)], [done('a', [12, 12, 12], 0)]);
    expect(hasChanges(p)).toBe(false);
  });
});

describe('modalWeight y puntos', () => {
  it('toma el peso más repetido, y el más alto en empate', () => {
    expect(modalWeight([{ weightKg: 60 }, { weightKg: 60 }, { weightKg: 70 }])).toBe(60);
    expect(modalWeight([{ weightKg: 60 }, { weightKg: 70 }])).toBe(70);
    expect(modalWeight([])).toBe(0);
  });
  it('puntos base de la sesión', () => {
    expect(sessionBasePoints(12, 4000)).toBe(50 + 24 + 40);
    expect(sessionBasePoints(0, 0)).toBe(50);
  });
});
