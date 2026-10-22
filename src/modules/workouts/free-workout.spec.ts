import {
  FULL_BODY,
  FreeWorkoutGroup,
  freeWorkoutTargets,
  omitReasonFor,
  planFreeWorkout,
  rankAlternatives,
  remainingSets,
} from './free-workout';
import { startFreeWorkoutSchema, swapSessionExerciseSchema } from './free-workout.schemas';

const FOUR_EXERCISES = 4;
const FIVE_EXERCISES = 5;
const SIX_EXERCISES = 6;
const THREE_SETS = 3;
const FOUR_SETS = 4;
const ONE_DONE = 1;
const TWO_DONE = 2;
const FIVE_DONE = 5;
const ONE_SET = 1;
const CORE_REPS_MIN = 12;
const CORE_REPS_MAX = 15;
const CORE_REST = 60;
const BACK_REPS_MIN = 8;
const BACK_REPS_MAX = 12;
const BACK_REST = 90;
const STARS_HIGH = 5;
const STARS_MID = 4;
const STARS_LOW = 3;
const TWO_SHARED = 2;
const ONE_SHARED = 1;
const THREE_SHARED = 3;

const candidates = (entries: Array<[FreeWorkoutGroup, string[]]>) => new Map(entries);

describe('planFreeWorkout', () => {
  it('reparte por turnos entre las zonas elegidas, en su orden', () => {
    const plan = planFreeWorkout(
      ['CHEST', 'ARMS'],
      candidates([
        ['CHEST', ['c1', 'c2', 'c3']],
        ['ARMS', ['a1', 'a2', 'a3']],
      ]),
      FOUR_EXERCISES,
    );
    expect(plan.map((item) => item.exerciseId)).toEqual(['c1', 'a1', 'c2', 'a2']);
    expect(plan.map((item) => item.group)).toEqual(['CHEST', 'ARMS', 'CHEST', 'ARMS']);
  });

  it('no repite un ejercicio que trabaja dos zonas', () => {
    const plan = planFreeWorkout(
      ['CHEST', 'SHOULDERS'],
      candidates([
        ['CHEST', ['press', 'c2']],
        ['SHOULDERS', ['press', 's2']],
      ]),
      FOUR_EXERCISES,
    );
    expect(plan.map((item) => item.exerciseId)).toEqual(['press', 'c2', 's2']);
  });

  it('si una zona se queda sin candidatos, las demás rellenan', () => {
    const plan = planFreeWorkout(
      ['CALVES', 'LEGS'],
      candidates([
        ['CALVES', ['p1']],
        ['LEGS', ['l1', 'l2', 'l3']],
      ]),
      FOUR_EXERCISES,
    );
    expect(plan.map((item) => item.exerciseId)).toEqual(['p1', 'l1', 'l2', 'l3']);
  });

  it('sin zonas arma cuerpo completo', () => {
    const all = candidates(FULL_BODY.map((group) => [group, [`${group}-1`]]));
    const plan = planFreeWorkout([], all, SIX_EXERCISES);
    expect(plan.map((item) => item.group)).toEqual([...FULL_BODY]);
  });

  it('devuelve vacío si el catálogo no tiene nada', () => {
    expect(planFreeWorkout(['BACK'], new Map(), FIVE_EXERCISES)).toEqual([]);
  });
});

describe('objetivos y motivos', () => {
  it('core y pantorrillas llevan más repeticiones y menos descanso', () => {
    expect(freeWorkoutTargets('CORE')).toMatchObject({
      targetSets: THREE_SETS,
      repsMin: CORE_REPS_MIN,
      repsMax: CORE_REPS_MAX,
      restSeconds: CORE_REST,
    });
    expect(freeWorkoutTargets('BACK')).toMatchObject({
      targetSets: THREE_SETS,
      repsMin: BACK_REPS_MIN,
      repsMax: BACK_REPS_MAX,
      restSeconds: BACK_REST,
    });
  });

  it('traduce el motivo del cambio al de omisión', () => {
    expect(omitReasonFor('MAQUINA_OCUPADA')).toBe('EQUIPO_OCUPADO');
    expect(omitReasonFor('MOLESTIA')).toBe('DOLOR');
    expect(omitReasonFor('CAMBIO_DE_PLAN')).toBe('OTRO');
  });

  it('el ejercicio nuevo hereda las series que faltaban, al menos una', () => {
    expect(remainingSets(FOUR_SETS, ONE_DONE)).toBe(THREE_SETS);
    expect(remainingSets(THREE_SETS, FIVE_DONE)).toBe(ONE_SET);
    expect(remainingSets(null, TWO_DONE)).toBeNull();
  });
});

describe('rankAlternatives', () => {
  const rows = [
    { id: 'misma-maquina', equipment: 'Máquina', sharedPrimary: TWO_SHARED, shared: THREE_SHARED, recommended: STARS_HIGH },
    { id: 'mancuernas', equipment: 'Mancuernas', sharedPrimary: ONE_SHARED, shared: TWO_SHARED, recommended: STARS_MID },
    { id: 'polea', equipment: 'Polea', sharedPrimary: TWO_SHARED, shared: TWO_SHARED, recommended: STARS_LOW },
  ];

  it('sin motivo de equipo, manda el parecido muscular', () => {
    expect(rankAlternatives(rows, 'máquina', 'MOLESTIA').map((row) => row.id)).toEqual([
      'misma-maquina',
      'polea',
      'mancuernas',
    ]);
  });

  it('con la máquina ocupada, la misma máquina baja al final', () => {
    expect(rankAlternatives(rows, 'máquina', 'MAQUINA_OCUPADA').map((row) => row.id)).toEqual([
      'polea',
      'mancuernas',
      'misma-maquina',
    ]);
  });
});

describe('esquemas', () => {
  it('la rutina libre acepta cuerpo vacío y quita zonas repetidas', () => {
    expect(startFreeWorkoutSchema.parse({})).toEqual({ groups: [], size: SIX_EXERCISES, empty: false, observation: null });
    expect(startFreeWorkoutSchema.parse({ grupos: ['CHEST', 'CHEST'], ejercicios: FOUR_EXERCISES }).groups).toEqual(['CHEST']);
  });

  it('rechaza zonas que no existen y campos de más', () => {
    expect(() => startFreeWorkoutSchema.parse({ grupos: ['NECK'] })).toThrow();
    expect(() => startFreeWorkoutSchema.parse({ extra: 1 })).toThrow();
  });

  it('el cambio es solo hoy por defecto', () => {
    const parsed = swapSessionExerciseSchema.parse({
      ejercicioId: '00000000-0000-4000-8000-000000000001',
      motivo: 'MAQUINA_OCUPADA',
    });
    expect(parsed).toEqual({
      exerciseId: '00000000-0000-4000-8000-000000000001',
      reason: 'MAQUINA_OCUPADA',
      scope: 'SESION',
      note: null,
    });
  });
});
