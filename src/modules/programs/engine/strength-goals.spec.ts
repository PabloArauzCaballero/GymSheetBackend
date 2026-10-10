import {
  bestE1rm,
  epley,
  goalWeek,
  isGoalReached,
  isReliableEstimate,
  realisticGoalRange,
  workingWeightForGoalWeek,
} from './strength-goals';

describe('Epley', () => {
  it.each([
    [100, 1, 100],
    [100, 5, 116.67],
    [80, 10, 106.67],
    [60, 8, 76],
  ])('%f kg × %i reps → %f', (w, r, e) => {
    expect(epley(w, r)).toBeCloseTo(e, 2);
  });
  it('datos inválidos dan 0', () => {
    expect(epley(0, 5)).toBe(0);
    expect(epley(100, 0)).toBe(0);
    expect(epley(-5, 5)).toBe(0);
  });
  it('es fiable hasta 10 repeticiones', () => {
    expect(isReliableEstimate(10)).toBe(true);
    expect(isReliableEstimate(11)).toBe(false);
    expect(isReliableEstimate(0)).toBe(false);
  });
  it('bestE1rm prefiere las series fiables y cae a las otras si no hay', () => {
    expect(bestE1rm([{ weightKg: 100, reps: 5 }, { weightKg: 50, reps: 20 }])).toBeCloseTo(116.67, 2);
    expect(bestE1rm([{ weightKg: 50, reps: 20 }])).toBeCloseTo(83.33, 2);
    expect(bestE1rm([])).toBeNull();
    expect(bestE1rm([{ weightKg: 0, reps: 10 }])).toBeNull();
  });
});

describe('goalWeek (bloques de 4)', () => {
  it.each([
    [1, 70, false],
    [2, 75, false],
    [3, 80, false],
    [4, 65, true],
    [5, 77.5, false],
    [6, 82.5, false],
    [7, 87.5, false],
    [8, 65, true],
    [9, 85, false],
    [10, 90, false],
    [11, 95, false],
    [15, 95, false],
  ])('semana %i → %f %%, descarga=%s', (week, percent, deload) => {
    expect(goalWeek(week)).toEqual({ percent, isDeload: deload });
  });
  it('semana 0 o negativa se trata como la 1', () => {
    expect(goalWeek(0).percent).toBe(70);
  });
});

describe('metas', () => {
  it('peso de trabajo = % del e1RM redondeado al disco', () => {
    expect(workingWeightForGoalWeek(1, 100)).toBe(70);
    expect(workingWeightForGoalWeek(2, 117)).toBe(87.5);
    expect(workingWeightForGoalWeek(4, 100)).toBe(65);
  });
  it('meta alcanzada cuando el e1RM llega al objetivo', () => {
    expect(isGoalReached(120, 120)).toBe(true);
    expect(isGoalReached(119.9, 120)).toBe(false);
    expect(isGoalReached(null, 120)).toBe(false);
    expect(isGoalReached(130, null)).toBe(false);
  });
  it('rango realista: +5–10 %, principiante hasta +15 %', () => {
    expect(realisticGoalRange(100, false)).toEqual({ minKg: 105, maxKg: 110 });
    expect(realisticGoalRange(100, true)).toEqual({ minKg: 105, maxKg: 115 });
  });
});
