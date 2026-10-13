import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Noche 2026-10-13 · D1 (saltar serie / omitir ejercicio), D2 (descanso e
 * intervalo a mano, con «guardar en mi rutina») y D6 (dobles toques).
 */
describe('Workouts · saltar, omitir, descanso a mano e idempotencia (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let stranger: { token: string; id: string };
  let routineId: string;
  let dayId: string;
  let sessionId: string;
  let benchSe: string;
  let rowSe: string;
  let plankSe: string;
  let curlSe: string;

  type SessionExercise = {
    id: string;
    descansoSeg: number | null;
    descansoEntreSeg: number | null;
    duracionSeg: number | null;
    series: Array<{ id: string; numeroSerie: number }>;
    saltadas: Array<{ id: string; numeroSerie: number; motivo: string; nota: string | null }>;
    omitido: { motivo: string; nota: string | null; fecha: string } | null;
  };

  const strengthSet = (numeroSerie: number, pesoKg = 60, repeticiones = 8) => ({
    numeroSerie,
    repeticiones,
    pesoKg,
    rir: 2,
    descansoSegAnterior: 90,
  });

  const sessionExercise = async (id: string): Promise<SessionExercise> => {
    const res = await e2e.as(owner.token).get(`/workouts/${sessionId}`).expect(200);
    return (res.body.data.ejercicios as SessionExercise[]).find((item) => item.id === id)!;
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('skip-owner');
    stranger = await e2e.register('skip-stranger');
    const api = e2e.as(owner.token);
    const stamp = Date.now();
    const bench = await createPersonalExercise(api, `Press salto ${stamp}`);
    const row = await createPersonalExercise(api, `Remo salto ${stamp}`);
    const plank = await createPersonalExercise(api, `Plancha salto ${stamp}`);
    const curl = await createPersonalExercise(api, `Curl salto ${stamp}`);
    const routine = await api
      .post('/routines')
      .send({
        nombre: `Saltos ${stamp}`,
        dias: [
          {
            diaSemana: 1,
            ejercicios: [
              { ejercicioId: bench, seriesObjetivo: 3, repsMin: 6, repsMax: 8, descansoSeg: 120, grupo: 1, descansoEntreSeg: 10 },
              { ejercicioId: row, seriesObjetivo: 3, repsMin: 6, repsMax: 8, descansoSeg: 120, grupo: 1, descansoEntreSeg: 10 },
              { ejercicioId: plank, seriesObjetivo: 3, duracionSeg: 45, descansoSeg: 60 },
              { ejercicioId: curl, seriesObjetivo: 3, repsMin: 10, repsMax: 12, descansoSeg: 60 },
            ],
          },
        ],
      })
      .expect(201);
    routineId = routine.body.data.id as string;
    dayId = routine.body.data.dias[0].id as string;
    const started = await api.post(`/routines/${routineId}/start`).send({ routineDayId: dayId }).expect(201);
    sessionId = started.body.data.id as string;
    [benchSe, rowSe, plankSe, curlSe] = started.body.data.ejercicios.map((e: { id: string }) => e.id);
    expect(started.body.data).toMatchObject({
      rutinaId: routineId,
      rutinaDiaId: dayId,
      seriesSaltadas: 0,
      ejerciciosOmitidos: 0,
    });
    expect(started.body.data.ejercicios[0]).toMatchObject({ saltadas: [], omitido: null });
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  // ─────────────────────────────────────────────────────────────── D1 · saltar

  it('salta una serie con motivo y la sesión la cuenta aparte de las series', async () => {
    const api = e2e.as(owner.token);
    await api.post(`/workouts/session-exercises/${benchSe}/sets`).send(strengthSet(1)).expect(201);
    const skipped = await api
      .post(`/workouts/session-exercises/${benchSe}/skipped-sets`)
      .send({ numeroSerie: 2, motivo: 'CANSANCIO' })
      .expect(201);
    expect(skipped.body.data).toMatchObject({ numeroSerie: 2, motivo: 'CANSANCIO', nota: null });

    const session = await api.get(`/workouts/${sessionId}`).expect(200);
    expect(session.body.data.seriesSaltadas).toBe(1);
    const bench = (session.body.data.ejercicios as SessionExercise[]).find((e) => e.id === benchSe)!;
    expect(bench.series).toHaveLength(1);
    expect(bench.saltadas).toEqual([expect.objectContaining({ id: skipped.body.data.id, numeroSerie: 2 })]);
  });

  it('repetir el salto del mismo número corrige el motivo, no crea otra fila', async () => {
    const api = e2e.as(owner.token);
    const again = await api
      .post(`/workouts/session-exercises/${benchSe}/skipped-sets`)
      .send({ numeroSerie: 2, motivo: 'DOLOR', nota: 'Molestia en el hombro' })
      .expect(201);
    const bench = await sessionExercise(benchSe);
    expect(bench.saltadas).toHaveLength(1);
    expect(bench.saltadas[0]).toMatchObject({ id: again.body.data.id, motivo: 'DOLOR', nota: 'Molestia en el hombro' });
  });

  it('no deja saltar una serie ya registrada ni aceptar un motivo inventado', async () => {
    const api = e2e.as(owner.token);
    const taken = await api
      .post(`/workouts/session-exercises/${benchSe}/skipped-sets`)
      .send({ numeroSerie: 1, motivo: 'PRISA' })
      .expect(409);
    expect(taken.body.code).toBe('SET_NUMBER_TAKEN');
    await api
      .post(`/workouts/session-exercises/${benchSe}/skipped-sets`)
      .send({ numeroSerie: 3, motivo: 'PEREZA' })
      .expect(400);
  });

  it('registrar después esa serie borra el salto (la persona al final la hizo)', async () => {
    const api = e2e.as(owner.token);
    await api.post(`/workouts/session-exercises/${benchSe}/sets`).send(strengthSet(2)).expect(201);
    const bench = await sessionExercise(benchSe);
    expect(bench.saltadas).toEqual([]);
    expect(bench.series.map((s) => s.numeroSerie)).toEqual([1, 2]);
  });

  it('deshace un salto, y nadie más puede saltar ni deshacer en esta sesión', async () => {
    const api = e2e.as(owner.token);
    const skipped = await api
      .post(`/workouts/session-exercises/${benchSe}/skipped-sets`)
      .send({ numeroSerie: 3, motivo: 'PRISA' })
      .expect(201);
    const id = skipped.body.data.id as string;
    await e2e.as(stranger.token).del(`/workouts/skipped-sets/${id}`).expect(404);
    await e2e
      .as(stranger.token)
      .post(`/workouts/session-exercises/${benchSe}/skipped-sets`)
      .send({ numeroSerie: 3, motivo: 'PRISA' })
      .expect(404);
    await api.del(`/workouts/skipped-sets/${id}`).expect(200);
    expect((await sessionExercise(benchSe)).saltadas).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────── D1 · omitir

  it('omite un ejercicio entero con motivo y lo recupera', async () => {
    const api = e2e.as(owner.token);
    const omitted = await api
      .post(`/workouts/session-exercises/${curlSe}/omit`)
      .send({ motivo: 'EQUIPO_OCUPADO' })
      .expect(201);
    expect(omitted.body.data.omitido).toMatchObject({ motivo: 'EQUIPO_OCUPADO', nota: null });
    expect(omitted.body.data.ejercicio?.id).toBeTruthy();
    const firstDate = omitted.body.data.omitido.fecha as string;

    // Repetir cambia el motivo pero no la hora en que se decidió.
    const again = await api
      .post(`/workouts/session-exercises/${curlSe}/omit`)
      .send({ motivo: 'PRISA', nota: 'Me cierran' })
      .expect(201);
    expect(again.body.data.omitido).toMatchObject({ motivo: 'PRISA', nota: 'Me cierran', fecha: firstDate });

    const session = await api.get(`/workouts/${sessionId}`).expect(200);
    expect(session.body.data.ejerciciosOmitidos).toBe(1);

    await e2e.as(stranger.token).del(`/workouts/session-exercises/${curlSe}/omit`).expect(404);
    const restored = await api.del(`/workouts/session-exercises/${curlSe}/omit`).expect(200);
    expect(restored.body.data.omitido).toBeNull();
  });

  // ──────────────────────────────────────────────────────── D2 · descanso a mano

  it('routine-link dice si se puede guardar en la rutina', async () => {
    const link = await e2e.as(owner.token).get(`/workouts/${sessionId}/routine-link`).expect(200);
    expect(link.body.data).toMatchObject({ rutinaId: routineId, rutinaDiaId: dayId, editable: true });
    await e2e.as(stranger.token).get(`/workouts/${sessionId}/routine-link`).expect(404);
  });

  it('cambia el descanso solo en la sesión si no se pide guardarlo', async () => {
    const api = e2e.as(owner.token);
    const res = await api
      .patch(`/workouts/${sessionId}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: curlSe, descansoSeg: 75 }] })
      .expect(200);
    expect(res.body.data.rutina).toEqual({
      guardado: false,
      rutinaId: null,
      ejerciciosActualizados: 0,
      motivo: 'NO_SOLICITADO',
    });
    const curl = (res.body.data.sesion.ejercicios as SessionExercise[]).find((e) => e.id === curlSe)!;
    expect(curl.descansoSeg).toBe(75);

    const routine = await api.get(`/routines/${routineId}`).expect(200);
    const routineCurl = routine.body.data.dias[0].ejercicios[3];
    expect(routineCurl.descansoSeg).toBe(60);
  });

  it('«a todos los que quedan» + «guardar en mi rutina» escribe sesión y rutina', async () => {
    const api = e2e.as(owner.token);
    const res = await api
      .patch(`/workouts/${sessionId}/rest-settings`)
      .send({
        cambios: [
          { sesionEjercicioId: rowSe, descansoSeg: 150, descansoEntreSeg: 20 },
          { sesionEjercicioId: plankSe, descansoSeg: 45, duracionSeg: 60 },
          { sesionEjercicioId: curlSe, descansoSeg: 90 },
        ],
        guardarEnRutina: true,
      })
      .expect(200);
    expect(res.body.data.rutina).toEqual({
      guardado: true,
      rutinaId: routineId,
      ejerciciosActualizados: 3,
      motivo: null,
    });
    const byId = new Map((res.body.data.sesion.ejercicios as SessionExercise[]).map((e) => [e.id, e]));
    expect(byId.get(rowSe)).toMatchObject({ descansoSeg: 150, descansoEntreSeg: 20 });
    expect(byId.get(plankSe)).toMatchObject({ descansoSeg: 45, duracionSeg: 60 });
    expect(byId.get(benchSe)).toMatchObject({ descansoSeg: 120, descansoEntreSeg: 10 });

    const routine = await api.get(`/routines/${routineId}`).expect(200);
    const [, row, plank, curl] = routine.body.data.dias[0].ejercicios;
    expect(row).toMatchObject({ descansoSeg: 150, descansoEntreSeg: 20 });
    expect(plank).toMatchObject({ descansoSeg: 45, duracionSeg: 60 });
    expect(curl).toMatchObject({ descansoSeg: 90 });
  });

  it('rechaza un intervalo fuera de un bloque y un tiempo en un ejercicio por repeticiones', async () => {
    const api = e2e.as(owner.token);
    const between = await api
      .patch(`/workouts/${sessionId}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: curlSe, descansoEntreSeg: 15 }] })
      .expect(400);
    expect(between.body.code).toBe('REST_SETTING_INVALID');
    const timed = await api
      .patch(`/workouts/${sessionId}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: curlSe, duracionSeg: 30 }] })
      .expect(400);
    expect(timed.body.code).toBe('REST_SETTING_INVALID');
    // Nada de la petición rechazada quedó aplicado.
    expect((await sessionExercise(curlSe)).descansoSeg).toBe(90);
    await api
      .patch(`/workouts/${sessionId}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: '00000000-0000-4000-8000-000000000999', descansoSeg: 30 }] })
      .expect(404);
    await e2e
      .as(stranger.token)
      .patch(`/workouts/${sessionId}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: curlSe, descansoSeg: 30 }] })
      .expect(404);
  });

  it('no guarda en una rutina ajena: 403 ROUTINE_NOT_OWNED y la sesión queda intacta', async () => {
    const guest = await e2e.register('skip-guest');
    const api = e2e.as(guest.token);
    const exercise = await createPersonalExercise(api, `Ajena ${Date.now()}`);
    const routine = await api
      .post('/routines')
      .send({
        nombre: `Ajena ${Date.now()}`,
        dias: [{ diaSemana: 2, ejercicios: [{ ejercicioId: exercise, seriesObjetivo: 3, repsMin: 8, repsMax: 10, descansoSeg: 90 }] }],
      })
      .expect(201);
    const guestRoutine = routine.body.data.id as string;
    const started = await api
      .post(`/routines/${guestRoutine}/start`)
      .send({ routineDayId: routine.body.data.dias[0].id })
      .expect(201);
    const guestSession = started.body.data.id as string;
    const guestExercise = started.body.data.ejercicios[0].id as string;
    // La rutina pasa a ser de otra persona: la sesión sigue naciendo de ella,
    // pero quien entrena ya no la puede editar (como con una pública ajena).
    await e2e.sql(`UPDATE training.routines SET created_by_user_id = :other WHERE id = :id`, {
      other: stranger.id,
      id: guestRoutine,
    });

    const link = await api.get(`/workouts/${guestSession}/routine-link`).expect(200);
    expect(link.body.data).toMatchObject({ rutinaId: guestRoutine, editable: false });

    const denied = await api
      .patch(`/workouts/${guestSession}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: guestExercise, descansoSeg: 30 }], guardarEnRutina: true })
      .expect(403);
    expect(denied.body.code).toBe('ROUTINE_NOT_OWNED');
    const after = await api.get(`/workouts/${guestSession}`).expect(200);
    expect(after.body.data.ejercicios[0].descansoSeg).toBe(90);

    // Sin guardar en la rutina sí puede ajustar SU sesión.
    await api
      .patch(`/workouts/${guestSession}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: guestExercise, descansoSeg: 30 }] })
      .expect(200);
    await api.patch(`/workouts/${guestSession}/cancel`).expect(200);
    // D6: cancelar dos veces no es un error.
    const twice = await api.patch(`/workouts/${guestSession}/cancel`).expect(200);
    expect(twice.body.data.estado).toBe('CANCELADA');
  });

  it('una sesión libre no tiene rutina donde guardar: SIN_RUTINA, sin error', async () => {
    const free = await e2e.register('skip-free');
    const api = e2e.as(free.token);
    const exercise = await createPersonalExercise(api, `Libre ${Date.now()}`);
    const session = await api.post('/workouts').send({}).expect(201);
    const added = await api
      .post(`/workouts/${session.body.data.id}/exercises`)
      .send({ ejercicioId: exercise, orden: 1 })
      .expect(201);
    const res = await api
      .patch(`/workouts/${session.body.data.id}/rest-settings`)
      .send({ cambios: [{ sesionEjercicioId: added.body.data.id, descansoSeg: 45 }], guardarEnRutina: true })
      .expect(200);
    expect(res.body.data.rutina).toMatchObject({ guardado: false, motivo: 'SIN_RUTINA' });
    expect(res.body.data.sesion.ejercicios[0].descansoSeg).toBe(45);
    expect(res.body.data.sesion).toMatchObject({ rutinaId: null, rutinaDiaId: null });
  });

  // ─────────────────────────────────────────────────────────── D6 · dobles toques

  it('la misma serie enviada dos veces seguidas no da 409: devuelve la que ya está', async () => {
    const api = e2e.as(owner.token);
    const first = await api.post(`/workouts/session-exercises/${rowSe}/sets`).send(strengthSet(1, 50)).expect(201);
    const second = await api.post(`/workouts/session-exercises/${rowSe}/sets`).send(strengthSet(1, 50)).expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    // Otra serie distinta con el mismo número sigue siendo un conflicto.
    await api.post(`/workouts/session-exercises/${rowSe}/sets`).send(strengthSet(1, 55)).expect(409);
    expect((await sessionExercise(rowSe)).series).toHaveLength(1);
  });

  it('finalizar dos veces, incluso a la vez, devuelve el mismo premio y no lo paga doble', async () => {
    const api = e2e.as(owner.token);
    await api.post(`/workouts/session-exercises/${curlSe}/skipped-sets`).send({ numeroSerie: 1, motivo: 'TECNICA' }).expect(201);
    await api.post(`/workouts/session-exercises/${plankSe}/omit`).send({ motivo: 'OTRO' }).expect(201);

    const [a, b] = await Promise.all([
      api.patch(`/workouts/${sessionId}/finish`).send({}),
      api.patch(`/workouts/${sessionId}/finish`).send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const repeated = [a, b].filter((res) => res.body.data.yaFinalizada === true);
    expect(repeated).toHaveLength(1);
    expect(a.body.data.progression).not.toBeNull();
    expect(b.body.data.progression).toEqual(a.body.data.progression);
    expect(a.body.data).toMatchObject({ estado: 'FINALIZADA', seriesSaltadas: 1, ejerciciosOmitidos: 1 });

    const third = await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200);
    expect(third.body.data.yaFinalizada).toBe(true);
    expect(third.body.data.progression).toEqual(a.body.data.progression);

    // Las saltadas no son series: 3 registradas en toda la sesión.
    const progression = await api.get('/me/progression').expect(200);
    expect(progression.body.data.stats).toMatchObject({ totalSessions: 1, totalSets: 3 });

    // Con la sesión cerrada ya no se puede saltar ni omitir.
    await api.post(`/workouts/session-exercises/${curlSe}/skipped-sets`).send({ numeroSerie: 2, motivo: 'PRISA' }).expect(403);
    await api.del(`/workouts/session-exercises/${plankSe}/omit`).expect(403);
  });
});
