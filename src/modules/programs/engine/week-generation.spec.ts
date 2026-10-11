import { BaseDay, generateWeeks, roundToPlate } from './week-generation';

const days: BaseDay[] = [
  {
    dayId: 'd1',
    weekday: 1,
    name: 'Empuje',
    exercises: [
      { routineExerciseId: 'r1', exerciseId: 'e1', order: 1, targetSets: 4, repsMin: 6, repsMax: 8, targetWeightKg: 60 },
      { routineExerciseId: 'r2', exerciseId: 'e2', order: 2, targetSets: 3, repsMin: 10, repsMax: 12, targetWeightKg: null },
    ],
  },
];

describe('generateWeeks', () => {
  it.each([
    [4, 4, [4]],
    [8, 4, [4, 8]],
    [12, 4, [4, 8, 12]],
    [12, 5, [5, 10]],
    [12, 6, [6, 12]],
  ])('%i semanas con descarga cada %i: descargas en %j', (duration, every, expected) => {
    const weeks = generateWeeks({ days, durationWeeks: duration, progression: { activa: true, descargaCada: every } });
    expect(weeks.filter((w) => w.esDescarga).map((w) => w.numero)).toEqual(expected);
  });

  it('sin descarga si dura menos que el ciclo', () => {
    const weeks = generateWeeks({ days, durationWeeks: 3, progression: { activa: true, descargaCada: 4 } });
    expect(weeks.some((w) => w.esDescarga)).toBe(false);
  });

  it('sin configuración todas las semanas son iguales a la base', () => {
    const weeks = generateWeeks({ days, durationWeeks: 4 });
    expect(weeks).toHaveLength(4);
    expect(weeks.every((w) => !w.esDescarga && w.factorCarga === 1)).toBe(true);
    expect(weeks[0].dias[0].ejercicios[0].series).toBe(4);
  });

  it('la descarga es activa: 50 % del volumen y 90 % de la carga, nunca menos de 1 serie', () => {
    const [, , , deload] = generateWeeks({ days, durationWeeks: 4, progression: { activa: true, descargaCada: 4 } });
    const [press, curl] = deload.dias[0].ejercicios;
    expect(press.series).toBe(2);
    expect(press.pesoObjetivoKg).toBe(53.75); // 60 × 0,9 = 54 → disco de 1,25 kg
    expect(curl.series).toBe(2); // round(1.5) = 2
    expect(curl.pesoObjetivoKg).toBeNull();
    const single = generateWeeks({
      days: [{ ...days[0], exercises: [{ ...days[0].exercises[0], targetSets: 1 }] }],
      durationWeeks: 4,
      progression: { activa: true, descargaCada: 4 },
    });
    expect(single[3].dias[0].ejercicios[0].series).toBe(1);
  });

  it('un ajuste manual de la semana manda sobre la regla', () => {
    const weeks = generateWeeks({
      days,
      durationWeeks: 4,
      progression: { activa: true, descargaCada: 4 },
      overrides: [
        { weekNumber: 4, isDeload: false, volumeFactor: 1, loadFactor: 1 },
        { weekNumber: 2, isDeload: true, volumeFactor: 0.7, loadFactor: 0.95, note: 'Viaje' },
      ],
    });
    expect(weeks[3].esDescarga).toBe(false);
    expect(weeks[1].esDescarga).toBe(true);
    expect(weeks[1].factorVolumen).toBe(0.7);
    expect(weeks[1].nota).toBe('Viaje');
  });

  it('limita la duración a 1..52', () => {
    expect(generateWeeks({ days, durationWeeks: 0 })).toHaveLength(1);
    expect(generateWeeks({ days, durationWeeks: 400 })).toHaveLength(52);
  });

  it('redondea al disco de 1,25 kg', () => {
    expect(roundToPlate(59.4)).toBe(60);
    expect(roundToPlate(56.3)).toBe(56.25);
  });

  it('conserva descanso, RIR, nota, bloque y duración en cada semana, también en la descarga (C3.a)', () => {
    const grouped: BaseDay[] = [
      {
        dayId: 'd1',
        weekday: 1,
        name: 'Torso',
        exercises: [
          { ...days[0].exercises[0], restSeconds: 120, targetRir: 2, note: 'Codos pegados', group: 1, groupType: 'SUPERSERIE', restBetweenSeconds: 15 },
          { ...days[0].exercises[1], restSeconds: 90, group: 1, groupType: 'SUPERSERIE', restBetweenSeconds: 15 },
          { routineExerciseId: 'r3', exerciseId: 'e3', order: 3, targetSets: 3, repsMin: null, repsMax: null, targetWeightKg: null, durationSeconds: 45 },
        ],
      },
    ];
    const weeks = generateWeeks({ days: grouped, durationWeeks: 4, progression: { activa: true, descargaCada: 4 } });
    for (const week of [weeks[0], weeks[3]]) {
      const [a, b, plank] = week.dias[0].ejercicios;
      expect(a).toMatchObject({ descansoSeg: 120, rirObjetivo: 2, nota: 'Codos pegados', grupo: 1, grupoTipo: 'SUPERSERIE', descansoEntreSeg: 15, duracionSeg: null });
      expect(b).toMatchObject({ descansoSeg: 90, grupo: 1, grupoTipo: 'SUPERSERIE' });
      expect(plank).toMatchObject({ grupo: null, grupoTipo: null, duracionSeg: 45, repsMin: null, repsMax: null, descansoSeg: null, rirObjetivo: null, nota: null });
    }
  });
});
