import {
  applyDoubleProgression,
  defaultIncrementKg,
  formatKg,
  LiftState,
  PerformedSet,
  validSets,
} from './double-progression';

const lift = (over: Partial<LiftState> = {}): LiftState => ({
  suggestedKg: 60,
  incrementKg: 2.5,
  repsMin: 6,
  repsMax: 8,
  rirTarget: null,
  consecutiveFails: 0,
  ...over,
});
const sets = (reps: number[], weightKg = 60, rir: number | null = null): PerformedSet[] =>
  reps.map((r) => ({ reps: r, weightKg, rir }));

describe('applyDoubleProgression', () => {
  it.each([
    ['todas las series en el tope → sube', [8, 8, 8], 'RAISE', 62.5],
    ['por encima del tope también sube', [9, 10, 8], 'RAISE', 62.5],
    ['dentro del rango sin llegar al tope → mantiene', [8, 7, 6], 'HOLD', 60],
    ['una serie bajo el mínimo (1.ª vez) → mantiene y cuenta el fallo', [8, 8, 5], 'HOLD', 60],
  ])('%s', (_name, reps, action, kg) => {
    const out = applyDoubleProgression(lift(), sets(reps), { isDeload: false });
    expect(out.action).toBe(action);
    expect(out.suggestedKg).toBe(kg);
  });

  it('cuenta el primer fallo y no lo cuenta si la siguiente sesión va bien', () => {
    const first = applyDoubleProgression(lift(), sets([8, 8, 5]), { isDeload: false });
    expect(first.consecutiveFails).toBe(1);
    const ok = applyDoubleProgression(lift({ consecutiveFails: 1 }), sets([7, 7, 6]), { isDeload: false });
    expect(ok.consecutiveFails).toBe(0);
    expect(ok.action).toBe('HOLD');
  });

  it('dos fallos seguidos bajan un 5 % redondeado al disco', () => {
    const out = applyDoubleProgression(lift({ consecutiveFails: 1 }), sets([5, 5, 4]), { isDeload: false });
    expect(out.action).toBe('LOWER');
    expect(out.suggestedKg).toBe(57.5); // 60 × 0,95 = 57 → 57,5
    expect(out.consecutiveFails).toBe(0);
    expect(out.message).toContain('Bajamos un poco');
  });

  it('el ejemplo del plan: 62,5 × 0,95 = 59,4 → 60 kg', () => {
    const out = applyDoubleProgression(lift({ suggestedKg: 62.5, consecutiveFails: 1 }), sets([4, 4, 4], 62.5), { isDeload: false });
    expect(out.suggestedKg).toBe(60);
  });

  it('en semana de descarga no cambia nada, ni siquiera los fallos', () => {
    const out = applyDoubleProgression(lift({ consecutiveFails: 1 }), sets([3, 3, 3]), { isDeload: true });
    expect(out).toMatchObject({ action: 'DELOAD_SKIP', suggestedKg: 60, consecutiveFails: 1 });
  });

  it('sin series válidas no cambia nada', () => {
    expect(applyDoubleProgression(lift(), [], { isDeload: false }).action).toBe('NO_DATA');
    const warmups = sets([8, 8], 30);
    expect(applyDoubleProgression(lift(), warmups, { isDeload: false }).action).toBe('NO_DATA');
  });

  it('los calentamientos (< 80 % del peso) no cuentan para subir ni para fallar', () => {
    const mixed = [...sets([12], 30), ...sets([8, 8, 8])];
    expect(applyDoubleProgression(lift(), mixed, { isDeload: false }).action).toBe('RAISE');
    const failing = [...sets([8], 30), ...sets([3, 3])];
    expect(applyDoubleProgression(lift(), failing, { isDeload: false }).consecutiveFails).toBe(1);
  });

  it('el RIR objetivo frena la subida si llegaste al límite del esfuerzo', () => {
    const tooHard = applyDoubleProgression(lift({ rirTarget: 2 }), sets([8, 8, 8], 60, 0), { isDeload: false });
    expect(tooHard.action).toBe('HOLD');
    const fine = applyDoubleProgression(lift({ rirTarget: 2 }), sets([8, 8, 8], 60, 1), { isDeload: false });
    expect(fine.action).toBe('RAISE');
    const unknown = applyDoubleProgression(lift({ rirTarget: 2 }), sets([8, 8, 8], 60, null), { isDeload: false });
    expect(unknown.action).toBe('RAISE');
  });

  it('peso corporal (0 kg): sugiere lastre, no suma kilos', () => {
    const out = applyDoubleProgression(lift({ suggestedKg: 0 }), sets([8, 8, 8], 0), { isDeload: false });
    expect(out).toMatchObject({ action: 'ADD_LOAD', suggestedKg: 0 });
    expect(out.message).toContain('lastre');
  });

  it('con mancuernas el paso mínimo es 2 kg', () => {
    const out = applyDoubleProgression(lift({ suggestedKg: 20, incrementKg: 2.5 }), sets([8, 8, 8], 20), { isDeload: false, stepKg: 2 });
    expect(out.suggestedKg).toBe(22);
  });

  it('el incremento de 5 kg del tren inferior se respeta', () => {
    const out = applyDoubleProgression(lift({ suggestedKg: 100, incrementKg: 5 }), sets([8, 8, 8], 100), { isDeload: false });
    expect(out.suggestedKg).toBe(105);
  });

  it('un fallo con peso 0 nunca baja de 0', () => {
    const out = applyDoubleProgression(lift({ suggestedKg: 0, consecutiveFails: 5 }), sets([2], 0), { isDeload: false });
    expect(out.suggestedKg).toBe(0);
  });
});

describe('defaultIncrementKg', () => {
  it.each([
    ['Piernas', 5],
    ['Cuádriceps', 5],
    ['Glúteos', 5],
    ['upper legs', 5],
    ['Pecho', 2.5],
    ['Espalda', 2.5],
    ['Hombros', 2.5],
    ['', 2.5],
    [null, 2.5],
    [undefined, 2.5],
  ])('%s → %f kg', (group, expected) => {
    expect(defaultIncrementKg(group)).toBe(expected);
  });
});

describe('helpers', () => {
  it('validSets descarta reps 0 y cargas livianas', () => {
    expect(validSets([{ reps: 0, weightKg: 60, rir: null }, { reps: 5, weightKg: 47, rir: null }, { reps: 5, weightKg: 48, rir: null }], 60)).toHaveLength(1);
  });
  it('formatKg usa coma decimal', () => {
    expect(formatKg(60)).toBe('60 kg');
    expect(formatKg(62.5)).toBe('62,5 kg');
    expect(formatKg(53.75)).toBe('53,75 kg');
  });
  it('el mensaje de subida sale con coma decimal', () => {
    const out = applyDoubleProgression(lift(), sets([8, 8, 8]), { isDeload: false });
    expect(out.message).toBe('¡Sube a 62,5 kg!');
  });
});
