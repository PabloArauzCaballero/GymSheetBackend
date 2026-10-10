import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-11 · «Recomendadas por REPP»: solo SYSTEM_ADMIN las marca; el catálogo las separa de las públicas. */
describe('Routines v2 · official (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  let sys: { token: string; id: string };
  let coach: { token: string; id: string };
  const tag = `off${Date.now().toString(36)}`;
  let routineId = '';

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('off-ana');
    leo = await e2e.register('off-leo');
    sys = await e2e.register('off-sys');
    coach = await e2e.register('off-coach');
    await e2e.promote(sys.id, 'SYSTEM_ADMIN');
    await e2e.promote(coach.id, 'ADMIN');
    const ex = await createPersonalExercise(e2e.as(ana.token), `${tag} ex`);
    const res = await e2e.as(ana.token).post('/routines').send({ nombre: `${tag} Para oficial`, dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: ex }] }] }).expect(201);
    routineId = res.body.data.id;
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  it('solo una pública visible puede ser oficial', async () => {
    await e2e.as(sys.token).post(`/admin/routines/${routineId}/official`).expect(400);
  });

  it('un socio o un ADMIN de gimnasio no marcan oficiales (OFFICIAL_FORBIDDEN)', async () => {
    await e2e.as(ana.token).post(`/admin/routines/${routineId}/official`).expect(403);
    await e2e.as(ana.token).post(`/admin/routines/${routineId}/publish`).catch(() => undefined);
    await e2e.as(ana.token).post(`/routines/${routineId}/publish`).expect(201);
    const res = await e2e.as(coach.token).post(`/admin/routines/${routineId}/official`).expect(403);
    expect(res.body.code).toBe('OFFICIAL_FORBIDDEN');
  });

  it('SYSTEM_ADMIN la marca: sale en Recomendadas por REPP y deja de salir en Públicas', async () => {
    const res = await e2e.as(sys.token).post(`/admin/routines/${routineId}/official`).expect(201);
    expect(res.body.data.esOficial).toBe(true);
    const official = await e2e.as(leo.token).get(`/routines?scope=official&q=${tag}`).expect(200);
    expect(official.body.data.items.map((r: { id: string }) => r.id)).toEqual([routineId]);
    expect(official.body.data.items[0].esOficial).toBe(true);
    const pub = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}`).expect(200);
    expect(pub.body.data.items).toHaveLength(0);
  });

  it('una oficial no se despublica ni se edita por su autora, solo por REPP', async () => {
    const unpublish = await e2e.as(ana.token).post(`/routines/${routineId}/unpublish`).expect(403);
    expect(unpublish.body.code).toBe('OFFICIAL_FORBIDDEN');
    await e2e.as(ana.token).put(`/routines/${routineId}/structure`).send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: (await createPersonalExercise(e2e.as(ana.token), `${tag} ex2`)) }] }] }).expect(403);
    await e2e.as(ana.token).patch(`/routines/${routineId}`).send({ nombre: 'Intento' }).expect(403);
    const edited = await e2e.as(sys.token).patch(`/routines/${routineId}`).send({ descripcion: 'Curada por REPP' }).expect(200);
    expect(edited.body.data.descripcion).toBe('Curada por REPP');
  });

  it('se puede valorar y comentar una oficial como cualquier pública', async () => {
    await e2e.as(leo.token).put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 5 }).expect(200);
    await e2e.as(leo.token).post(`/comments/ROUTINE/${routineId}`).send({ texto: 'Buena' }).expect(201);
  });

  it('desmarcar la devuelve a Públicas', async () => {
    await e2e.as(sys.token).del(`/admin/routines/${routineId}/official`).expect(200);
    const pub = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}`).expect(200);
    expect(pub.body.data.items).toHaveLength(1);
  });

  it('SYSTEM_ADMIN crea una oficial directamente y la consola la lista con sus métricas', async () => {
    const ex = await createPersonalExercise(e2e.as(sys.token), `${tag} sysex`);
    const created = await e2e
      .as(sys.token)
      .post('/admin/routines')
      .send({ nombre: `${tag} Oficial directa`, objetivo: 'SALUD_GENERAL', duracionSemanas: 4, dias: [{ diaSemana: 2, ejercicios: [{ ejercicioId: ex }] }] })
      .expect(201);
    expect(created.body.data).toMatchObject({ esOficial: true, visibilidad: 'PUBLIC' });
    const list = await e2e.as(sys.token).get(`/admin/routines?oficial=true&q=${tag}`).expect(200);
    expect(list.body.data.items[0]).toMatchObject({ nombre: `${tag} Oficial directa`, esOficial: true, denunciasAbiertas: 0 });
    const insights = await e2e.as(sys.token).get(`/admin/routines/${created.body.data.id}/insights`).expect(200);
    expect(insights.body.data).toMatchObject({ copias: 0, comentarios: 0, denuncias: 0 });
    await e2e.as(leo.token).get('/admin/routines').expect(403);
  });
});
