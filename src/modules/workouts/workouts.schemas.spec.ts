import { createWorkoutSetSchema, updateWorkoutSetSchema } from './workouts.schemas';

describe('createWorkoutSetSchema — series de fuerza por tiempo', () => {
  it('acepta una serie por tiempo sin repeticiones, peso ni RIR', () => {
    const parsed = createWorkoutSetSchema.parse({
      numeroSerie: 1,
      duracionSeg: 45,
      descansoSegAnterior: 0,
    });
    expect(parsed).toEqual({
      type: 'FUERZA',
      setNumber: 1,
      repetitions: null,
      weightKg: null,
      rir: null,
      durationSeconds: 45,
      previousRestSeconds: 0,
    });
  });

  it('acepta lastre y RIR en una serie por tiempo', () => {
    const parsed = createWorkoutSetSchema.parse({
      tipoSerie: 'FUERZA',
      numeroSerie: 2,
      duracionSeg: 60,
      pesoKg: 10,
      rir: 1,
      descansoSegAnterior: 30,
    });
    expect(parsed).toMatchObject({ durationSeconds: 60, weightKg: 10, rir: 1, repetitions: null });
  });

  it('rechaza repeticiones y duración a la vez', () => {
    const result = createWorkoutSetSchema.safeParse({
      numeroSerie: 1,
      duracionSeg: 45,
      repeticiones: 10,
      pesoKg: 0,
      rir: 2,
      descansoSegAnterior: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rechaza una duración fuera de 1..3600', () => {
    for (const duracionSeg of [0, 3601]) {
      const result = createWorkoutSetSchema.safeParse({
        numeroSerie: 1,
        duracionSeg,
        descansoSegAnterior: 0,
      });
      expect(result.success).toBe(false);
    }
  });

  it('sigue exigiendo repeticiones, peso y RIR a una serie sin duración', () => {
    const result = createWorkoutSetSchema.safeParse({ numeroSerie: 1, descansoSegAnterior: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual([
        'pesoKg',
        'repeticiones',
        'rir',
      ]);
    }
  });

  it('mantiene la serie por repeticiones de siempre, con duración null', () => {
    const parsed = createWorkoutSetSchema.parse({
      numeroSerie: 1,
      repeticiones: 8,
      pesoKg: 60,
      rir: 2,
      descansoSegAnterior: 90,
    });
    expect(parsed).toEqual({
      type: 'FUERZA',
      setNumber: 1,
      repetitions: 8,
      weightKg: 60,
      rir: 2,
      durationSeconds: null,
      previousRestSeconds: 90,
    });
  });
});

describe('updateWorkoutSetSchema', () => {
  it('acepta editar solo la duración', () => {
    expect(updateWorkoutSetSchema.parse({ duracionSeg: 50 })).toEqual({ durationSeconds: 50 });
  });
});
