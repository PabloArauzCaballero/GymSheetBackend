import {
  isProgramCompleted,
  isSuspiciousSet,
  isWeekFulfilled,
  nextMultiplier,
  sessionQualifies,
  weekBonus,
} from './week-close';

describe('multiplicador', () => {
  it('sube 0,2 por semana cumplida hasta 2,0', () => {
    let m = 1;
    const seen: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      m = nextMultiplier(m, true);
      seen.push(m);
    }
    expect(seen).toEqual([1.2, 1.4, 1.6, 1.8, 2, 2, 2]);
  });
  it('vuelve a 1,0 si no se cumple, desde cualquier valor', () => {
    expect(nextMultiplier(1.8, false)).toBe(1);
    expect(nextMultiplier(1, false)).toBe(1);
  });
  it('no acumula error de coma flotante', () => {
    let m = 1;
    for (let i = 0; i < 3; i += 1) m = nextMultiplier(m, true);
    expect(m).toBe(1.6);
  });
});

describe('bono de la semana', () => {
  it.each([
    [300, 1.2, 60],
    [300, 2, 300],
    [250, 1.4, 100],
    [333, 1.2, 67],
    [0, 1.6, 0],
    [300, 1, 0],
  ])('base %i × %f → bono %i', (base, mult, bonus) => {
    expect(weekBonus(base, mult)).toBe(bonus);
  });
  it('nunca es negativo', () => {
    expect(weekBonus(300, 0.5)).toBe(0);
  });
});

describe('semana cumplida', () => {
  it('exige todas las sesiones y ≥ 80 % del trabajo', () => {
    expect(isWeekFulfilled({ sessionsPlan: 3, sessionsDone: 3, workRatio: 0.8 })).toBe(true);
    expect(isWeekFulfilled({ sessionsPlan: 3, sessionsDone: 2, workRatio: 1 })).toBe(false);
    expect(isWeekFulfilled({ sessionsPlan: 3, sessionsDone: 3, workRatio: 0.79 })).toBe(false);
  });
  it('hacer más sesiones de las planeadas también cumple', () => {
    expect(isWeekFulfilled({ sessionsPlan: 2, sessionsDone: 4, workRatio: 1 })).toBe(true);
  });
  it('una semana sin sesiones planeadas no se puede cumplir', () => {
    expect(isWeekFulfilled({ sessionsPlan: 0, sessionsDone: 0, workRatio: 1 })).toBe(false);
  });
});

describe('programa completado y antifraude', () => {
  it('≥ 75 % de semanas cumplidas', () => {
    expect(isProgramCompleted(6, 8)).toBe(true);
    expect(isProgramCompleted(5, 8)).toBe(false);
    expect(isProgramCompleted(0, 0)).toBe(false);
  });
  it('una sesión cuenta con ≥ 10 min y ≥ 3 series', () => {
    expect(sessionQualifies({ durationMinutes: 10, strengthSets: 3 })).toBe(true);
    expect(sessionQualifies({ durationMinutes: 9, strengthSets: 10 })).toBe(false);
    expect(sessionQualifies({ durationMinutes: 60, strengthSets: 2 })).toBe(false);
  });
  it('una serie con más de 3 × el e1RM es sospechosa', () => {
    expect(isSuspiciousSet(301, 100)).toBe(true);
    expect(isSuspiciousSet(300, 100)).toBe(false);
    expect(isSuspiciousSet(500, null)).toBe(false);
  });
});

describe('los puntos de modo nunca bajan (D8, propiedad)', () => {
  // Generador determinista: la prueba debe reproducirse igual en cualquier máquina.
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it('en 1000 secuencias aleatorias de semanas cumplidas e incumplidas el total acumulado es monótono', () => {
    for (let run = 0; run < 1000; run += 1) {
      const random = seeded(run + 1);
      let multiplier = 1;
      let total = 0;
      for (let week = 0; week < 52; week += 1) {
        const fulfilled = random() < 0.6;
        const base = Math.floor(random() * 800);
        multiplier = nextMultiplier(multiplier, fulfilled);
        const bonus = fulfilled ? weekBonus(base, multiplier) : 0;
        expect(bonus).toBeGreaterThanOrEqual(0);
        const previous = total;
        total += bonus;
        expect(total).toBeGreaterThanOrEqual(previous);
        expect(multiplier).toBeGreaterThanOrEqual(1);
        expect(multiplier).toBeLessThanOrEqual(2);
      }
    }
  });
});
