import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Rutinas v2 · estructura (RF-03..08): días, huella, calendario, ajustes de
 * semana y compatibilidad con las apps instaladas (POST plano + ejercicio suelto).
 */
describe('Routines v2 · structure (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let stranger: { token: string; id: string };
  let squat: string;
  let bench: string;
  let row: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('rv2-owner');
    stranger = await e2e.register('rv2-stranger');
    const api = e2e.as(owner.token);
    squat = await createPersonalExercise(api, `Sentadilla v2 ${Date.now()}`);
    bench = await createPersonalExercise(api, `Press v2 ${Date.now()}`);
    row = await createPersonalExercise(api, `Remo v2 ${Date.now()}`);
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    nombre: 'Empuje y pierna',
    objetivo: 'HIPERTROFIA',
    duracionSemanas: 8,
    progresion: { activa: true, descargaCada: 4 },
    dias: [
      { diaSemana: 1, nombre: 'Pierna', ejercicios: [{ ejercicioId: squat, seriesObjetivo: 4, repsMin: 6, repsMax: 8 }] },
      {
        diaSemana: 3,
        nombre: 'Empuje',
        ejercicios: [
          { ejercicioId: bench, seriesObjetivo: 3, repsMin: 8, repsMax: 10 },
          { ejercicioId: row, seriesObjetivo: 3 },
        ],
      },
    ],
    ...extra,
  });

  it('crea una rutina con días y la devuelve agrupada y aplanada', async () => {
    const res = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const r = res.body.data;
    expect(r.visibilidad).toBe('PRIVATE');
    expect(r.duracionSemanas).toBe(8);
    expect(r.dias).toHaveLength(2);
    expect(r.dias[0]).toMatchObject({ diaSemana: 1, nombre: 'Pierna' });
    expect(r.dias[1].ejercicios).toHaveLength(2);
    expect(r.ejercicios.map((e: { orden: number }) => e.orden)).toEqual([1, 2, 3]);
    expect(r.huellaCorta).toMatch(/^[0-9a-f]{8}$/);
    expect(r.esMia).toBe(true);
    expect(r.puedoEditar).toBe(true);
    expect(r.version).toBe(1);
  });

  it('rechaza un día sin ejercicios con ROUTINE_HAS_NO_DAYS', async () => {
    const res = await e2e
      .as(owner.token)
      .post('/routines')
      .send(body({ dias: [{ diaSemana: 1, ejercicios: [] }] }))
      .expect(400);
    expect(res.body.code).toBe('ROUTINE_HAS_NO_DAYS');
  });

  it('rechaza dos días con el mismo día de la semana', async () => {
    const day = { diaSemana: 2, ejercicios: [{ ejercicioId: squat }] };
    await e2e.as(owner.token).post('/routines').send(body({ dias: [day, day] })).expect(400);
  });

  it('una privada ajena responde 404 (no confirma que exista)', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    await e2e.as(stranger.token).get(`/routines/${created.body.data.id}`).expect(404);
    await e2e.as(stranger.token).get(`/routines/${created.body.data.id}/calendar`).expect(404);
    await e2e.as(stranger.token).put(`/routines/${created.body.data.id}/structure`).send({ dias: [] }).expect(400);
  });

  it('PUT structure reemplaza días y ejercicios y cambia la huella', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const id = created.body.data.id as string;
    const before = created.body.data.huellaCorta as string;
    const res = await e2e
      .as(owner.token)
      .put(`/routines/${id}/structure`)
      .send({ dias: [{ diaSemana: 5, nombre: 'Full', ejercicios: [{ ejercicioId: row, seriesObjetivo: 5 }] }] })
      .expect(200);
    expect(res.body.data.dias).toHaveLength(1);
    expect(res.body.data.ejercicios).toHaveLength(1);
    expect(res.body.data.huellaCorta).not.toBe(before);
  });

  it('un extraño no puede reemplazar la estructura', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    await e2e
      .as(stranger.token)
      .put(`/routines/${created.body.data.id}/structure`)
      .send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: squat }] }] })
      .expect(404);
  });

  it('el calendario aplica la descarga activa cada 4 semanas', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const res = await e2e.as(owner.token).get(`/routines/${created.body.data.id}/calendar`).expect(200);
    const weeks = res.body.data.semanas;
    expect(weeks).toHaveLength(8);
    expect(weeks.filter((w: { esDescarga: boolean }) => w.esDescarga).map((w: { numero: number }) => w.numero)).toEqual([4, 8]);
    expect(weeks[3].dias[0].ejercicios[0].series).toBe(2); // 4 series × 0,5
    expect(weeks[0].dias[0].ejercicios[0].series).toBe(4);
  });

  it('un ajuste manual de semana manda sobre la regla y se puede quitar', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const id = created.body.data.id as string;
    await e2e.as(owner.token).put(`/routines/${id}/weeks/4`).send({ esDescarga: false, factorVolumen: 1, factorCarga: 1 }).expect(200);
    let cal = await e2e.as(owner.token).get(`/routines/${id}/calendar`).expect(200);
    expect(cal.body.data.semanas[3].esDescarga).toBe(false);
    await e2e.as(owner.token).del(`/routines/${id}/weeks/4`).expect(200);
    cal = await e2e.as(owner.token).get(`/routines/${id}/calendar`).expect(200);
    expect(cal.body.data.semanas[3].esDescarga).toBe(true);
    await e2e.as(owner.token).put(`/routines/${id}/weeks/9`).send({ esDescarga: true }).expect(400);
  });

  it('compatibilidad: POST plano sin días + ejercicio suelto cae en el primer día', async () => {
    const created = await e2e.as(owner.token).post('/routines').send({ nombre: 'Plana vieja' }).expect(201);
    expect(created.body.data.dias).toHaveLength(1);
    expect(created.body.data.dias[0].diaSemana).toBeNull();
    const id = created.body.data.id as string;
    const res = await e2e
      .as(owner.token)
      .post(`/routines/${id}/exercises`)
      .send({ ejercicioId: squat, orden: 1, seriesObjetivo: 3 })
      .expect(201);
    expect(res.body.data.dias[0].ejercicios).toHaveLength(1);
    expect(res.body.data.ejercicios).toHaveLength(1);
  });

  it('compatibilidad: visibilidad TEMPLATE de una app vieja se guarda PRIVATE y PUBLIC se rechaza', async () => {
    const legacy = await e2e.as(owner.token).post('/routines').send({ nombre: 'Vieja plantilla', visibilidad: 'TEMPLATE' }).expect(201);
    expect(legacy.body.data.visibilidad).toBe('PRIVATE');
    await e2e.as(owner.token).post('/routines').send({ nombre: 'Directa pública', visibilidad: 'PUBLIC' }).expect(400);
    await e2e.as(owner.token).patch(`/routines/${legacy.body.data.id}`).send({ visibilidad: 'PUBLIC' }).expect(400);
  });

  it('borrar archiva: deja de salir en «mine» pero no se destruye', async () => {
    const created = await e2e.as(owner.token).post('/routines').send({ nombre: 'Para archivar' }).expect(201);
    const id = created.body.data.id as string;
    await e2e.as(owner.token).del(`/routines/${id}`).expect(200);
    const list = await e2e.as(owner.token).get('/routines?scope=mine&pageSize=100').expect(200);
    expect(list.body.data.items.some((r: { id: string }) => r.id === id)).toBe(false);
    const still = await e2e.as(owner.token).get(`/routines/${id}`).expect(200);
    expect(still.body.data.estado).toBe('ARCHIVED');
  });
});
