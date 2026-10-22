import { HttpStatus } from '@nestjs/common';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Rutina libre por zonas (opcionales) y cambio de ejercicio con motivo y
 * alcance («solo hoy» / «siempre en mi rutina»), contra PostgreSQL real.
 */
describe('Workouts · rutina libre y cambio de ejercicio (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let stranger: { token: string; id: string };
  const chest: string[] = [];
  const arms: string[] = [];

  type SessionExercise = {
    id: string;
    orden: number;
    seriesObjetivo: number | null;
    repsMin: number | null;
    ejercicio: { id: string } | null;
    series: Array<{ id: string }>;
    omitido: { motivo: string } | null;
  };

  const REPS = 8;
  const LOAD_KG = 40;
  const RIR = 2;
  const REST_SECONDS = 90;
  const SETUP_TIMEOUT_MS = 60000;
  const FOUR = 4;
  const TOO_MANY = 50;
  const TARGET_SETS = 3;
  const REMAINING_AFTER_ONE = 2;
  const REPS_MAX = 10;
  const strengthSet = { numeroSerie: 1, repeticiones: REPS, pesoKg: LOAD_KG, rir: RIR, descansoSegAnterior: REST_SECONDS };

  const linkMuscle = async (exerciseId: string, muscleCode: string) =>
    e2e.sql(
      `INSERT INTO training.exercise_muscles (ejercicio_id, muscle_id, role)
       SELECT :exerciseId, id, 'PRIMARY' FROM training.muscles WHERE code = :muscleCode
       ON CONFLICT DO NOTHING`,
      { exerciseId, muscleCode },
    );

  const sessionOf = async (token: string, id: string) =>
    (await e2e.as(token).get(`/workouts/${id}`).expect(HttpStatus.OK)).body.data as { ejercicios: SessionExercise[] };

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('free-owner');
    stranger = await e2e.register('free-stranger');
    await e2e.sql(
      `INSERT INTO training.muscle_groups (code, name, region) VALUES
         ('CHEST', 'Pecho', 'UPPER'), ('ARMS', 'Brazos', 'UPPER')
       ON CONFLICT (code) DO NOTHING`,
    );
    await e2e.sql(
      `INSERT INTO training.muscles (code, name, latin_name, muscle_group_id)
       SELECT 'PECTORALIS_MAJOR', 'Pectoral mayor', 'Pectoralis major', id FROM training.muscle_groups WHERE code = 'CHEST'
       ON CONFLICT (code) DO NOTHING`,
    );
    await e2e.sql(
      `INSERT INTO training.muscles (code, name, latin_name, muscle_group_id)
       SELECT 'BICEPS_BRACHII', 'Bíceps', 'Biceps brachii', id FROM training.muscle_groups WHERE code = 'ARMS'
       ON CONFLICT (code) DO NOTHING`,
    );
    const api = e2e.as(owner.token);
    const stamp = Date.now();
    // En serie, no en paralelo: el orden de creación es el orden de las listas.
    const create = (names: readonly string[], muscle: string, into: string[]) =>
      names.reduce(async (previous, name) => {
        await previous;
        const id = await createPersonalExercise(api, `${name} ${stamp}`);
        await linkMuscle(id, muscle);
        into.push(id);
      }, Promise.resolve());
    await create(['Press banca', 'Press inclinado', 'Aperturas', 'Fondos'], 'PECTORALIS_MAJOR', chest);
    await create(['Curl barra', 'Curl martillo'], 'BICEPS_BRACHII', arms);
    // Press banca y press inclinado comparten máquina: con la máquina ocupada,
    // el inclinado debe bajar al final de los equivalentes.
    await e2e.sql(`UPDATE public.ejercicios SET required_equipment = 'Banco' WHERE id IN (:ids)`, {
      ids: [chest[0], chest[1]],
    });
    await e2e.sql(`UPDATE public.ejercicios SET required_equipment = 'Paralelas' WHERE id = :id`, { id: chest[3] });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await e2e.app?.close();
  });

  let freeSessionId: string;

  it('propone una sesión editable con las zonas elegidas, repartidas por turnos', async () => {
    const res = await e2e
      .as(owner.token)
      .post('/workouts/libre')
      .send({ grupos: ['CHEST', 'ARMS'], ejercicios: FOUR })
      .expect(HttpStatus.CREATED);
    freeSessionId = res.body.data.id as string;
    expect(res.body.data.rutinaLibre).toEqual({ grupos: ['CHEST', 'ARMS'], propuestos: FOUR, cuerpoCompleto: false });
    const exercises = res.body.data.ejercicios as SessionExercise[];
    expect(exercises.map((item) => item.orden)).toEqual(Array.from({ length: FOUR }, (_, index) => index + 1));
    const ids = exercises.map((item) => item.ejercicio?.id);
    expect(chest).toEqual(expect.arrayContaining([ids[0], ids[2]]));
    expect(arms).toEqual(expect.arrayContaining([ids[1], ids[3]]));
    expect(exercises[0]).toMatchObject({ seriesObjetivo: TARGET_SETS, repsMin: REPS });
  });

  it('no abre una segunda sesión mientras hay otra en curso', async () => {
    await e2e.as(owner.token).post('/workouts/libre').send({}).expect(HttpStatus.CONFLICT);
  });

  it('rechaza zonas inexistentes y campos de más', async () => {
    await e2e.as(stranger.token).post('/workouts/libre').send({ grupos: ['NECK'] }).expect(HttpStatus.BAD_REQUEST);
    await e2e.as(stranger.token).post('/workouts/libre').send({ ejercicios: TOO_MANY }).expect(HttpStatus.BAD_REQUEST);
  });

  it('nunca propone ejercicios personales de otra cuenta', async () => {
    const res = await e2e.as(stranger.token).post('/workouts/libre').send({ grupos: ['CHEST'] }).expect(HttpStatus.CREATED);
    expect(res.body.data.rutinaLibre.propuestos).toBe(0);
    expect(res.body.data.ejercicios).toEqual([]);
    await e2e.as(stranger.token).patch(`/workouts/${res.body.data.id as string}/cancel`).expect(HttpStatus.OK);
  });

  it('lista equivalentes sin repetir lo que ya está en la sesión y respeta el motivo', async () => {
    const session = await sessionOf(owner.token, freeSessionId);
    const first = session.ejercicios[0];
    const inSession = new Set(session.ejercicios.map((item) => item.ejercicio?.id));
    const res = await e2e
      .as(owner.token)
      .get(`/workouts/session-exercises/${first.id}/alternatives?motivo=MAQUINA_OCUPADA`)
      .expect(HttpStatus.OK);
    const ids = (res.body.data.alternativas as Array<{ id: string }>).map((item) => item.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => inSession.has(id))).toBe(false);
    expect(res.body.data.motivo).toBe('MAQUINA_OCUPADA');

    await e2e.as(stranger.token).get(`/workouts/session-exercises/${first.id}/alternatives`).expect(HttpStatus.NOT_FOUND);
  });

  it('sin series hechas, cambia el ejercicio en su sitio («solo hoy»)', async () => {
    const before = await sessionOf(owner.token, freeSessionId);
    const target = before.ejercicios[0];
    const replacement = chest.find((id) => !before.ejercicios.some((item) => item.ejercicio?.id === id))!;
    const res = await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${target.id}/swap`)
      .send({ ejercicioId: replacement, motivo: 'MOLESTIA', nota: 'Hombro' })
      .expect(HttpStatus.CREATED);
    expect(res.body.data).toMatchObject({
      sesionEjercicioId: target.id,
      conservoSeries: false,
      rutina: { guardado: false, motivo: 'NO_SOLICITADO' },
    });
    const swapped = (res.body.data.sesion.ejercicios as SessionExercise[]).find((item) => item.id === target.id)!;
    expect(swapped).toMatchObject({ orden: 1, ejercicio: { id: replacement }, omitido: null });
  });

  it('con series hechas, las conserva y añade el nuevo justo detrás con las que faltan', async () => {
    const api = e2e.as(owner.token);
    const before = await sessionOf(owner.token, freeSessionId);
    const [, target] = before.ejercicios;
    await api.post(`/workouts/session-exercises/${target.id}/sets`).send(strengthSet).expect(HttpStatus.CREATED);
    const replacement = arms.find((id) => id !== target.ejercicio?.id && !before.ejercicios.some((item) => item.ejercicio?.id === id));
    const other = replacement ?? chest.find((id) => !before.ejercicios.some((item) => item.ejercicio?.id === id))!;
    const res = await api
      .post(`/workouts/session-exercises/${target.id}/swap`)
      .send({ ejercicioId: other, motivo: 'MAQUINA_OCUPADA' })
      .expect(HttpStatus.CREATED);
    expect(res.body.data.conservoSeries).toBe(true);
    const after = res.body.data.sesion.ejercicios as SessionExercise[];
    expect(after).toHaveLength(before.ejercicios.length + 1);
    const original = after.find((item) => item.id === target.id)!;
    expect(original.series).toHaveLength(1);
    expect(original.omitido).toMatchObject({ motivo: 'EQUIPO_OCUPADO' });
    const added = after.find((item) => item.id === res.body.data.sesionEjercicioId)!;
    expect(added).toMatchObject({ orden: original.orden + 1, seriesObjetivo: REMAINING_AFTER_ONE, ejercicio: { id: other } });
    expect(new Set(after.map((item) => item.orden)).size).toBe(after.length);
  });

  it('rechaza cambiar por el mismo ejercicio, un motivo inventado o un ejercicio ajeno', async () => {
    const api = e2e.as(owner.token);
    const session = await sessionOf(owner.token, freeSessionId);
    const target = session.ejercicios[0];
    const same = await api
      .post(`/workouts/session-exercises/${target.id}/swap`)
      .send({ ejercicioId: target.ejercicio?.id, motivo: 'PREFERENCIA' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(same.body.code).toBe('SWAP_SAME_EXERCISE');
    await api
      .post(`/workouts/session-exercises/${target.id}/swap`)
      .send({ ejercicioId: chest[0], motivo: 'ABURRIDO' })
      .expect(HttpStatus.BAD_REQUEST);
    await e2e
      .as(stranger.token)
      .post(`/workouts/session-exercises/${target.id}/swap`)
      .send({ ejercicioId: chest[0], motivo: 'PREFERENCIA' })
      .expect(HttpStatus.NOT_FOUND);
  });

  it('«siempre» en una sesión libre avisa de que no hay rutina, sin fallar', async () => {
    const session = await sessionOf(owner.token, freeSessionId);
    const target = session.ejercicios[0];
    const replacement = chest.find((id) => !session.ejercicios.some((item) => item.ejercicio?.id === id))!;
    const res = await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${target.id}/swap`)
      .send({ ejercicioId: replacement, motivo: 'CAMBIO_DE_PLAN', alcance: 'RUTINA' })
      .expect(HttpStatus.CREATED);
    expect(res.body.data.rutina).toEqual({ guardado: false, rutinaId: null, motivo: 'SIN_RUTINA' });
    await e2e.as(owner.token).patch(`/workouts/${freeSessionId}/cancel`).expect(HttpStatus.OK);
  });

  it('«siempre» cambia el ejercicio también en la rutina propia', async () => {
    const api = e2e.as(owner.token);
    const routine = await api
      .post('/routines')
      .send({
        nombre: `Rutina cambio ${Date.now()}`,
        dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: chest[0], seriesObjetivo: TARGET_SETS, repsMin: REPS, repsMax: REPS_MAX }] }],
      })
      .expect(HttpStatus.CREATED);
    const routineId = routine.body.data.id as string;
    const dayId = routine.body.data.dias[0].id as string;
    const started = await api.post(`/routines/${routineId}/start`).send({ routineDayId: dayId }).expect(HttpStatus.CREATED);
    const sessionExerciseId = started.body.data.ejercicios[0].id as string;

    const res = await api
      .post(`/workouts/session-exercises/${sessionExerciseId}/swap`)
      .send({ ejercicioId: chest[3], motivo: 'SIN_EQUIPO', alcance: 'RUTINA' })
      .expect(HttpStatus.CREATED);
    expect(res.body.data.rutina).toEqual({ guardado: true, rutinaId: routineId, motivo: null });

    const updated = await api.get(`/routines/${routineId}`).expect(HttpStatus.OK);
    const exerciseIds = JSON.stringify(updated.body.data);
    expect(exerciseIds).toContain(chest[3]);
    expect(exerciseIds).not.toContain(chest[0]);
    await api.patch(`/workouts/${started.body.data.id as string}/cancel`).expect(HttpStatus.OK);
  });
});
