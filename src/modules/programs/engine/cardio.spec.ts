import {
  concurrentAdvice,
  countedMinutes,
  isCardioWeekFulfilled,
  maxHeartRate,
  targetMinutesForWeek,
  targetZone,
  zoneBounds,
  zoneOfHeartRate,
  zoneOfRpe,
} from './cardio';

describe('frecuencia cardíaca', () => {
  it.each([
    [20, 194],
    [30, 187],
    [40, 180],
    [50, 173],
    [60, 166],
  ])('Tanaka a los %i años = %i', (age, expected) => {
    expect(maxHeartRate(age)).toBe(expected);
  });
  it('zonas como % de la FC máxima si no hay FC en reposo', () => {
    expect(zoneBounds(2, 180)).toEqual({ minBpm: 108, maxBpm: 126 });
    expect(zoneBounds(5, 180)).toEqual({ minBpm: 162, maxBpm: 180 });
  });
  it('Karvonen cuando hay FC en reposo', () => {
    // reserva = 180 − 60 = 120; Z2 = 60 + 0,6..0,7 × 120
    expect(zoneBounds(2, 180, 60)).toEqual({ minBpm: 132, maxBpm: 144 });
  });
  it('la zona se acota a 1..5', () => {
    expect(zoneBounds(0, 180)).toEqual(zoneBounds(1, 180));
    expect(zoneBounds(9, 180)).toEqual(zoneBounds(5, 180));
  });
  it('zona de una FC media', () => {
    expect(zoneOfHeartRate(100, 180)).toBe(1);
    expect(zoneOfHeartRate(120, 180)).toBe(2);
    expect(zoneOfHeartRate(150, 180)).toBe(4);
    expect(zoneOfHeartRate(170, 180)).toBe(5);
    expect(zoneOfHeartRate(60, 180)).toBe(0);
  });
});

describe('esfuerzo percibido', () => {
  it.each([
    [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3], [7, 4], [8, 4], [9, 5], [10, 5],
  ])('RPE %i → Z%i', (rpe, zone) => {
    expect(zoneOfRpe(rpe)).toBe(zone);
  });
  it('zona objetivo desde cualquiera de los dos tipos', () => {
    expect(targetZone({ type: 'ZONA_FC', zone: 3 })).toBe(3);
    expect(targetZone({ type: 'RPE', rpe: 7 })).toBe(4);
  });
});

describe('minutos que cuentan', () => {
  const hr = { max: 180 };
  const z2 = { type: 'ZONA_FC', zone: 2 } as const;
  it('en la zona objetivo cuenta 1 por minuto', () => {
    expect(countedMinutes({ durationSeconds: 1800, avgHeartRate: 120 }, z2, hr)).toBe(30);
  });
  it('por encima también cuenta, y a intensidad vigorosa vale doble', () => {
    expect(countedMinutes({ durationSeconds: 1200, avgHeartRate: 150 }, z2, hr)).toBe(40);
  });
  it('por debajo de la zona no cuenta', () => {
    expect(countedMinutes({ durationSeconds: 1800, avgHeartRate: 100 }, z2, hr)).toBe(0);
  });
  it('sin FC usa el esfuerzo percibido', () => {
    expect(countedMinutes({ durationSeconds: 600, rpe: 4 }, z2, hr)).toBe(10);
    expect(countedMinutes({ durationSeconds: 600, rpe: 2 }, z2, hr)).toBe(0);
    expect(countedMinutes({ durationSeconds: 600, rpe: 8 }, z2, hr)).toBe(20);
  });
  it('sin dato de intensidad se da el beneficio de la duda', () => {
    expect(countedMinutes({ durationSeconds: 1800 }, z2, hr)).toBe(30);
    expect(countedMinutes({ durationSeconds: 1800 }, { type: 'RPE', rpe: 8 }, hr)).toBe(60);
  });
  it('usa la FC en reposo para decidir la zona', () => {
    // Karvonen: Z2 empieza en 132 lpm; con 120 lpm no llega.
    expect(countedMinutes({ durationSeconds: 600, avgHeartRate: 120 }, z2, { max: 180, rest: 60 })).toBe(0);
  });
});

describe('progresión y semana cumplida', () => {
  it.each([
    [30, 5, 1, 30],
    [30, 5, 2, 32],
    [30, 5, 3, 34],
    [30, 10, 4, 40],
    [280, 10, 3, 300],
    [30, 0, 5, 30],
  ])('base %i + %i %% semana %i → %i', (base, pct, week, expected) => {
    expect(targetMinutesForWeek(base, pct, week)).toBe(expected);
  });
  it('nunca crece más del 10 % por semana aunque se pida más', () => {
    expect(targetMinutesForWeek(100, 50, 2)).toBe(110);
  });
  it('semana cumplida: minutos ≥ objetivo × sesiones', () => {
    expect(isCardioWeekFulfilled({ countedMinutes: 90, targetMinutesPerSession: 30, sessionsPlan: 3 })).toBe(true);
    expect(isCardioWeekFulfilled({ countedMinutes: 89, targetMinutesPerSession: 30, sessionsPlan: 3 })).toBe(false);
    expect(isCardioWeekFulfilled({ countedMinutes: 100, targetMinutesPerSession: 30, sessionsPlan: 0 })).toBe(false);
  });
});

describe('cardio con pesas el mismo día', () => {
  it('sin pesas ese día no hay consejo', () => {
    expect(concurrentAdvice({ sameDayWithWeights: false, lowerBodyDay: true, modality: 'CORRER', minutes: 45 }).order).toBe('ANY');
  });
  it('pesas primero', () => {
    expect(concurrentAdvice({ sameDayWithWeights: true, lowerBodyDay: false, modality: 'CORRER', minutes: 45 }).order).toBe('WEIGHTS_FIRST');
  });
  it('pierna + correr > 30 min sugiere bici', () => {
    expect(concurrentAdvice({ sameDayWithWeights: true, lowerBodyDay: true, modality: 'CORRER', minutes: 45 }).suggestModality).toBe('BICI');
    expect(concurrentAdvice({ sameDayWithWeights: true, lowerBodyDay: true, modality: 'CORRER', minutes: 30 }).suggestModality).toBeNull();
    expect(concurrentAdvice({ sameDayWithWeights: true, lowerBodyDay: true, modality: 'BICI', minutes: 45 }).suggestModality).toBeNull();
  });
});
