import {
  createWorkoutSetSchema,
  omitSessionExerciseSchema,
  restSettingsSchema,
  skipSetSchema,
  updateWorkoutSetSchema,
} from './workouts.schemas';

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

describe('skipSetSchema / omitSessionExerciseSchema (D1)', () => {
  it('acepta los seis motivos y deja la nota en null si no viene', () => {
    for (const motivo of ['CANSANCIO', 'PRISA', 'DOLOR', 'EQUIPO_OCUPADO', 'TECNICA', 'OTRO']) {
      expect(skipSetSchema.parse({ numeroSerie: 2, motivo })).toEqual({
        setNumber: 2,
        reason: motivo,
        note: null,
      });
    }
  });

  it('rechaza un motivo desconocido y un número de serie fuera de rango', () => {
    expect(skipSetSchema.safeParse({ numeroSerie: 2, motivo: 'PEREZA' }).success).toBe(false);
    expect(skipSetSchema.safeParse({ numeroSerie: 0, motivo: 'PRISA' }).success).toBe(false);
  });

  it('recorta la nota y la limita a 280 caracteres', () => {
    expect(omitSessionExerciseSchema.parse({ motivo: 'OTRO', nota: '  máquina rota  ' })).toEqual({
      reason: 'OTRO',
      note: 'máquina rota',
    });
    expect(omitSessionExerciseSchema.safeParse({ motivo: 'OTRO', nota: 'x'.repeat(281) }).success).toBe(false);
  });
});

describe('restSettingsSchema (D2)', () => {
  const id = '00000000-0000-4000-8000-000000000010';
  const other = '00000000-0000-4000-8000-000000000011';

  it('traduce los cambios y no guarda en la rutina salvo que se pida', () => {
    expect(
      restSettingsSchema.parse({
        cambios: [
          { sesionEjercicioId: id, descansoSeg: 150 },
          { sesionEjercicioId: other, descansoSeg: 60, descansoEntreSeg: 15, duracionSeg: 45 },
        ],
      }),
    ).toEqual({
      changes: [
        { sessionExerciseId: id, restSeconds: 150 },
        { sessionExerciseId: other, restSeconds: 60, restBetweenSeconds: 15, durationSeconds: 45 },
      ],
      saveToRoutine: false,
    });
  });

  it('exige al menos un valor por cambio y al menos un cambio', () => {
    expect(restSettingsSchema.safeParse({ cambios: [{ sesionEjercicioId: id }] }).success).toBe(false);
    expect(restSettingsSchema.safeParse({ cambios: [] }).success).toBe(false);
  });

  it('rechaza el mismo ejercicio dos veces y valores fuera de rango', () => {
    expect(
      restSettingsSchema.safeParse({
        cambios: [
          { sesionEjercicioId: id, descansoSeg: 60 },
          { sesionEjercicioId: id, descansoSeg: 90 },
        ],
      }).success,
    ).toBe(false);
    expect(
      restSettingsSchema.safeParse({ cambios: [{ sesionEjercicioId: id, descansoSeg: 7201 }] }).success,
    ).toBe(false);
    expect(
      restSettingsSchema.safeParse({ cambios: [{ sesionEjercicioId: id, descansoEntreSeg: 601 }] }).success,
    ).toBe(false);
  });
});
