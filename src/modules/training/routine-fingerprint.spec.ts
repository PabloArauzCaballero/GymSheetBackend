import { canonicalRoutineText, FingerprintDay, FingerprintExercise, routineFingerprint } from './routine-fingerprint';

const ex = (id: string, order: number, sets = 3, min: number | null = 8, max: number | null = 10): FingerprintExercise => ({
  exerciseId: id,
  order,
  targetSets: sets,
  repsMin: min,
  repsMax: max,
});
const day = (weekday: number | null, ...exercises: FingerprintExercise[]): FingerprintDay => ({ weekday, exercises });

describe('routineFingerprint', () => {
  const base = [day(1, ex('a', 1), ex('b', 2)), day(3, ex('c', 1))];

  it('es un sha256 hexadecimal de 64 caracteres', () => {
    expect(routineFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('es estable', () => {
    expect(routineFingerprint(base)).toBe(routineFingerprint(base));
  });
  it('no depende del orden en que llegan los días', () => {
    expect(routineFingerprint([base[1], base[0]])).toBe(routineFingerprint(base));
  });
  it('no depende del orden del arreglo de ejercicios', () => {
    expect(routineFingerprint([day(1, ex('b', 2), ex('a', 1)), base[1]])).toBe(routineFingerprint(base));
  });
  it('no depende de los huecos en `orden`, solo de la posición', () => {
    expect(routineFingerprint([day(1, ex('a', 5), ex('b', 40)), base[1]])).toBe(routineFingerprint(base));
  });
  it('cambia si se intercambian dos ejercicios', () => {
    expect(routineFingerprint([day(1, ex('b', 1), ex('a', 2)), base[1]])).not.toBe(routineFingerprint(base));
  });
  it('cambia si cambia un ejercicio', () => {
    expect(routineFingerprint([day(1, ex('a', 1), ex('z', 2)), base[1]])).not.toBe(routineFingerprint(base));
  });
  it('cambia si cambian las series', () => {
    expect(routineFingerprint([day(1, ex('a', 1, 4), ex('b', 2)), base[1]])).not.toBe(routineFingerprint(base));
  });
  it('cambia si cambia una repetición', () => {
    expect(routineFingerprint([day(1, ex('a', 1, 3, 8, 12), ex('b', 2)), base[1]])).not.toBe(routineFingerprint(base));
  });
  it('cambia si un ejercicio pasa a otro día', () => {
    expect(routineFingerprint([day(1, ex('a', 1)), day(3, ex('b', 1), ex('c', 2))])).not.toBe(routineFingerprint(base));
  });
  it('distingue el día NULL (cualquier día) de un día concreto', () => {
    expect(routineFingerprint([day(null, ex('a', 1))])).not.toBe(routineFingerprint([day(1, ex('a', 1))]));
  });
  it('trata reps nulas distinto de reps con valor', () => {
    expect(routineFingerprint([day(1, ex('a', 1, 3, null, null))])).not.toBe(routineFingerprint([day(1, ex('a', 1))]));
  });
});

describe('routineFingerprint · bloques y duración (C3.a)', () => {
  const plain = [day(1, ex('a', 1), ex('b', 2))];
  const grouped = (g: number | null, d: number | null = null) => [
    day(1, { ...ex('a', 1), group: g, durationSeconds: d }, { ...ex('b', 2), group: g, durationSeconds: null }),
  ];

  it('un ejercicio sin grupo ni duración da el MISMO texto que antes (las huellas viejas no cambian)', () => {
    expect(canonicalRoutineText(grouped(null))).toBe('1|a:1:3:8:10,b:2:3:8:10');
    expect(routineFingerprint(grouped(null))).toBe(routineFingerprint(plain));
  });
  it('añade «:grupo:duracion» solo cuando hay alguno', () => {
    expect(canonicalRoutineText(grouped(1))).toBe('1|a:1:3:8:10:1:,b:2:3:8:10:1:');
    expect(canonicalRoutineText([day(1, { ...ex('a', 1, 3, null, null), durationSeconds: 45 })])).toBe('1|a:1:3::::45');
  });
  it('cambia si dos ejercicios pasan a ser superserie', () => {
    expect(routineFingerprint(grouped(1))).not.toBe(routineFingerprint(plain));
  });
  it('cambia si una serie pasa a ser por tiempo', () => {
    expect(routineFingerprint(grouped(null, 30))).not.toBe(routineFingerprint(plain));
  });
});
