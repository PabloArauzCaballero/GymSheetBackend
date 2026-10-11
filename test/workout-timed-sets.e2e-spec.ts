import { ProgressionRepository } from '../src/modules/progression/progression.repository';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Series de fuerza por tiempo (plancha 45 s): el ejercicio de la sesión copia
 * `duracionSeg` de la rutina y sus series se registran con `duracionSeg` y sin
 * repeticiones. No cuentan como volumen, repeticiones ni récord.
 */
describe('Workouts · series por tiempo (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let stranger: { token: string; id: string };
  let sessionId: string;
  let plankSe: string;
  let benchSe: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('timed-owner');
    stranger = await e2e.register('timed-stranger');
    const api = e2e.as(owner.token);
    const plank = await createPersonalExercise(api, `Plancha ${Date.now()}`);
    const bench = await createPersonalExercise(api, `Press tiempo ${Date.now()}`);
    const routine = await api
      .post('/routines')
      .send({
        nombre: `Core ${Date.now()}`,
        dias: [
          {
            diaSemana: 1,
            ejercicios: [
              { ejercicioId: plank, seriesObjetivo: 3, duracionSeg: 45 },
              { ejercicioId: bench, seriesObjetivo: 3, repsMin: 8, repsMax: 10 },
            ],
          },
        ],
      })
      .expect(201);
    const routineId = routine.body.data.id as string;
    const day = routine.body.data.dias[0].id as string;
    const started = await api.post(`/routines/${routineId}/start`).send({ routineDayId: day }).expect(201);
    sessionId = started.body.data.id as string;
    [plankSe, benchSe] = started.body.data.ejercicios.map((e: { id: string }) => e.id);
    expect(started.body.data.ejercicios[0]).toMatchObject({ duracionSeg: 45, repsMin: null });
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const timedSet = (numeroSerie: number, extra: Record<string, unknown> = {}) => ({
    numeroSerie,
    duracionSeg: 45,
    descansoSegAnterior: 0,
    ...extra,
  });

  it('registra una serie por tiempo sin repeticiones y la devuelve con duracionSeg', async () => {
    const res = await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${plankSe}/sets`)
      .send(timedSet(1))
      .expect(201);
    expect(res.body.data).toMatchObject({
      numeroSerie: 1,
      tipoSerie: 'FUERZA',
      repeticiones: null,
      pesoKg: null,
      rir: null,
      duracionSeg: 45,
    });
  });

  it('admite lastre en una serie por tiempo y deja editar la duración', async () => {
    const res = await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${plankSe}/sets`)
      .send(timedSet(2, { pesoKg: 10, rir: 1 }))
      .expect(201);
    const edited = await e2e
      .as(owner.token)
      .patch(`/workouts/sets/${res.body.data.id}`)
      .send({ duracionSeg: 50 })
      .expect(200);
    expect(edited.body.data).toMatchObject({ duracionSeg: 50, pesoKg: 10, repeticiones: null });

    const mismatch = await e2e
      .as(owner.token)
      .patch(`/workouts/sets/${res.body.data.id}`)
      .send({ repeticiones: 10 })
      .expect(400);
    expect(mismatch.body.code).toBe('SET_KIND_MISMATCH');
  });

  it('rechaza repeticiones y duración a la vez, y una duración fuera de rango', async () => {
    await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${plankSe}/sets`)
      .send(timedSet(3, { repeticiones: 10, pesoKg: 0, rir: 2 }))
      .expect(400);
    await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${plankSe}/sets`)
      .send(timedSet(3, { duracionSeg: 3601 }))
      .expect(400);
  });

  it('un ejercicio por repeticiones no acepta una serie por tiempo', async () => {
    const res = await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${benchSe}/sets`)
      .send(timedSet(1))
      .expect(400);
    expect(res.body.code).toBe('SET_DURATION_NOT_ALLOWED');
  });

  it('una serie por repeticiones no admite duración al editarla', async () => {
    const res = await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${benchSe}/sets`)
      .send({ numeroSerie: 1, repeticiones: 8, pesoKg: 50, rir: 2, descansoSegAnterior: 0 })
      .expect(201);
    expect(res.body.data.duracionSeg).toBeNull();
    const mismatch = await e2e
      .as(owner.token)
      .patch(`/workouts/sets/${res.body.data.id}`)
      .send({ duracionSeg: 30 })
      .expect(400);
    expect(mismatch.body.code).toBe('SET_KIND_MISMATCH');
  });

  it('la sesión de otra persona responde 404', async () => {
    await e2e
      .as(stranger.token)
      .post(`/workouts/session-exercises/${plankSe}/sets`)
      .send(timedSet(5))
      .expect(404);
  });

  it('al cerrar, las series por tiempo cuentan como series pero no como reps, volumen ni récord', async () => {
    // Una segunda serie de press más pesada: el récord es solo de press, no de la plancha con lastre.
    await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${benchSe}/sets`)
      .send({ numeroSerie: 2, repeticiones: 8, pesoKg: 55, rir: 2, descansoSegAnterior: 0 })
      .expect(201);
    await e2e
      .as(owner.token)
      .post(`/workouts/session-exercises/${plankSe}/sets`)
      .send(timedSet(3, { pesoKg: 20 }))
      .expect(201);
    const detail = await e2e.as(owner.token).get(`/workouts/${sessionId}`).expect(200);
    expect(detail.body.data.ejercicios[0].series.map((s: { duracionSeg: number }) => s.duracionSeg)).toEqual([45, 50, 45]);

    await e2e.as(owner.token).patch(`/workouts/${sessionId}/finish`).send({}).expect(200);
    const metrics = await e2e.app.get(ProgressionRepository).computeMetrics(owner.id);
    expect(metrics.totalSets).toBe(5);
    expect(metrics.totalReps).toBe(16);
    expect(metrics.totalVolumeKg).toBe(8 * 50 + 8 * 55);
    expect(metrics.personalRecords).toBe(1);
  });
});
