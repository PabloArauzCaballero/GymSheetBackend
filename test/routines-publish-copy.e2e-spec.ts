import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-09/RF-10 · publicar sin duplicados, copiar con atribución y sincronizar con el original. */
describe('Routines v2 · publish and copy (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  let a: string;
  let b: string;

  // Las pruebas comparten base: una huella aleatoria evita chocar con rutinas públicas de corridas anteriores.
  const SETS = 1 + Math.floor(Math.random() * 90);

  const routine = (nombre: string, ids: string[]) => ({
    nombre,
    objetivo: 'FUERZA',
    duracionSemanas: 6,
    dias: [{ diaSemana: 1, ejercicios: ids.map((ejercicioId) => ({ ejercicioId, seriesObjetivo: SETS, repsMin: 5, repsMax: 5 })) }],
  });

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('pub-ana');
    leo = await e2e.register('pub-leo');
    a = await createPersonalExercise(e2e.as(ana.token), `Pub A ${Date.now()}`);
    b = await createPersonalExercise(e2e.as(ana.token), `Pub B ${Date.now()}`);
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  let originalId = '';

  it('publicar una rutina completa la hace PUBLIC y visible a otro socio', async () => {
    const created = await e2e.as(ana.token).post('/routines').send(routine('Fuerza 5x5', [a, b])).expect(201);
    originalId = created.body.data.id;
    const res = await e2e.as(ana.token).post(`/routines/${originalId}/publish`).expect(201);
    expect(res.body.data.visibilidad).toBe('PUBLIC');
    expect(res.body.data.publicadaEn).toBeTruthy();
    const seen = await e2e.as(leo.token).get(`/routines/${originalId}`).expect(200);
    expect(seen.body.data.esMia).toBe(false);
    expect(seen.body.data.puedoEditar).toBe(false);
    await e2e.as(leo.token).put(`/routines/${originalId}/structure`).send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: a }] }] }).expect(403);
  });

  it('un ejercicio privado de la autora se abre desde la pública (D3)', async () => {
    await e2e.as(leo.token).get(`/exercises/${a}`).expect(200);
  });

  it('dos personas con los mismos ejercicios: la segunda no puede publicar (ROUTINE_DUPLICATE)', async () => {
    const list = await e2e.as(ana.token).get(`/exercises?pageSize=2&page=${1 + Math.floor(Math.random() * 300)}`).expect(200);
    const globals = list.body.data.items.filter((e: { tipoEjercicio: string }) => e.tipoEjercicio === 'GLOBAL');
    const [g1, g2] = [globals[0].id as string, globals[1].id as string];
    const first = await e2e.as(ana.token).post('/routines').send(routine('Global de Ana', [g1, g2])).expect(201);
    await e2e.as(ana.token).post(`/routines/${first.body.data.id}/publish`).expect(201);
    const twin = await e2e.as(leo.token).post('/routines').send(routine('Nombre distinto, mismos ejercicios', [g1, g2])).expect(201);
    const res = await e2e.as(leo.token).post(`/routines/${twin.body.data.id}/publish`).expect(409);
    expect(res.body.code).toBe('ROUTINE_DUPLICATE');
    expect(res.body.details.existingRoutineId).toBe(first.body.data.id);
    // Cambiar solo el nombre no evita el choque; cambiar una repetición sí.
    await e2e.as(leo.token).patch(`/routines/${twin.body.data.id}`).send({ nombre: 'Aún igual' }).expect(200);
    await e2e.as(leo.token).post(`/routines/${twin.body.data.id}/publish`).expect(409);
    await e2e
      .as(leo.token)
      .put(`/routines/${twin.body.data.id}/structure`)
      .send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: g1, seriesObjetivo: SETS, repsMin: 5, repsMax: 5 }, { ejercicioId: g2, seriesObjetivo: SETS, repsMin: 8, repsMax: 8 }] }] })
      .expect(200);
    await e2e.as(leo.token).post(`/routines/${twin.body.data.id}/publish`).expect(201);
  }, 20000);

  it('copiar crea una PRIVATE con atribución congelada y suma copias', async () => {
    const copy = await e2e.as(leo.token).post(`/routines/${originalId}/copy`).expect(201);
    const c = copy.body.data;
    expect(c.visibilidad).toBe('PRIVATE');
    expect(c.esMia).toBe(true);
    expect(c.basadaEnRutinaId).toBe(originalId);
    expect(c.atribucion).toMatchObject({ routineName: 'Fuerza 5x5', authorName: 'E2E pub-ana' });
    expect(c.dias[0].ejercicios).toHaveLength(2);
    const source = await e2e.as(ana.token).get(`/routines/${originalId}`).expect(200);
    expect(source.body.data.copias).toBe(1);
  });

  it('publicar una copia sin cambios choca con el original (ROUTINE_DUPLICATE)', async () => {
    const copy = await e2e.as(leo.token).post(`/routines/${originalId}/copy`).expect(201);
    const res = await e2e.as(leo.token).post(`/routines/${copy.body.data.id}/publish`).expect(409);
    expect(res.body.code).toBe('ROUTINE_DUPLICATE');
    expect(res.body.details.existingRoutineId).toBe(originalId);
  });

  it('editar la pública sube la versión; la copia lo ve y sincroniza solo cuando quiere (D2)', async () => {
    const copy = await e2e.as(leo.token).post(`/routines/${originalId}/copy`).expect(201);
    const copyId = copy.body.data.id as string;
    expect((await e2e.as(leo.token).get(`/routines/${copyId}`).expect(200)).body.data.hayVersionNueva).toBe(false);

    const edited = await e2e
      .as(ana.token)
      .put(`/routines/${originalId}/structure`)
      .send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: a, seriesObjetivo: 4, repsMin: 5, repsMax: 5 }] }] })
      .expect(200);
    expect(edited.body.data.version).toBe(2);

    const stale = await e2e.as(leo.token).get(`/routines/${copyId}`).expect(200);
    expect(stale.body.data.hayVersionNueva).toBe(true);
    expect(stale.body.data.dias[0].ejercicios).toHaveLength(2); // no se tocó sola

    const synced = await e2e.as(leo.token).post(`/routines/${copyId}/sync-from-source`).expect(201);
    expect(synced.body.data.actualizada).toBe(true);
    expect(synced.body.data.dias[0].ejercicios).toHaveLength(1);
    expect(synced.body.data.basadaEnVersion).toBe(2);
    expect((await e2e.as(leo.token).get(`/routines/${copyId}`).expect(200)).body.data.hayVersionNueva).toBe(false);
    const again = await e2e.as(leo.token).post(`/routines/${copyId}/sync-from-source`).expect(201);
    expect(again.body.data.actualizada).toBe(false);
  });

  it('editar una pública hasta igualar a otra devuelve 409 y no guarda nada', async () => {
    const list = await e2e.as(ana.token).get(`/exercises?pageSize=2&page=${400 + Math.floor(Math.random() * 250)}`).expect(200);
    const globals = list.body.data.items.filter((e: { tipoEjercicio: string }) => e.tipoEjercicio === 'GLOBAL');
    const [g1, g2] = [globals[0].id as string, globals[1].id as string];
    const x = await e2e.as(ana.token).post('/routines').send(routine('Rutina X', [g1])).expect(201);
    const y = await e2e.as(ana.token).post('/routines').send(routine('Rutina Y', [g1, g2])).expect(201);
    await e2e.as(ana.token).post(`/routines/${x.body.data.id}/publish`).expect(201);
    await e2e.as(ana.token).post(`/routines/${y.body.data.id}/publish`).expect(201);
    const before = (await e2e.as(ana.token).get(`/routines/${y.body.data.id}`).expect(200)).body.data;
    const edit = await e2e
      .as(ana.token)
      .put(`/routines/${y.body.data.id}/structure`)
      .send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: g1, seriesObjetivo: SETS, repsMin: 5, repsMax: 5 }] }] })
      .expect(409);
    expect(edit.body.code).toBe('ROUTINE_DUPLICATE');
    const after = (await e2e.as(ana.token).get(`/routines/${y.body.data.id}`).expect(200)).body.data;
    expect(after.version).toBe(before.version);
    expect(after.ejercicios).toHaveLength(2);
  });

  it('despublicar devuelve la rutina a PRIVATE y deja de verse; las copias siguen', async () => {
    const created = await e2e.as(ana.token).post('/routines').send(routine('Para despublicar', [b])).expect(201);
    const id = created.body.data.id as string;
    await e2e.as(ana.token).post(`/routines/${id}/publish`).expect(201);
    await e2e.as(leo.token).get(`/routines/${id}`).expect(200);
    const copy = await e2e.as(leo.token).post(`/routines/${id}/copy`).expect(201);
    await e2e.as(ana.token).post(`/routines/${id}/unpublish`).expect(201);
    await e2e.as(leo.token).get(`/routines/${id}`).expect(404);
    await e2e.as(leo.token).get(`/routines/${copy.body.data.id}`).expect(200);
  });

  it('no se puede publicar una rutina sin ejercicios (ROUTINE_HAS_NO_DAYS)', async () => {
    const empty = await e2e.as(ana.token).post('/routines').send({ nombre: 'Vacía' }).expect(201);
    const res = await e2e.as(ana.token).post(`/routines/${empty.body.data.id}/publish`).expect(400);
    expect(res.body.code).toBe('ROUTINE_HAS_NO_DAYS');
  });
});
