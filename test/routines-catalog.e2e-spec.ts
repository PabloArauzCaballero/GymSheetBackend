import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-01 · catálogo por pestañas: públicas, mías, compartidas; filtros, orden y cursor. */
describe('Routines v2 · catalog (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  const tag = `cat${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('cat-ana');
    leo = await e2e.register('cat-leo');
    const api = e2e.as(ana.token);
    const mk = async (key: string, nombre: string, dias: number[], objetivo: string, publish: boolean) => {
      const ex = await createPersonalExercise(api, `${tag} ${key}`);
      const res = await api
        .post('/routines')
        .send({ nombre: `${tag} ${nombre}`, objetivo, dias: dias.map((d) => ({ diaSemana: d, ejercicios: [{ ejercicioId: ex }] })) })
        .expect(201);
      ids[key] = res.body.data.id;
      if (publish) await api.post(`/routines/${ids[key]}/publish`).expect(201);
    };
    await mk('pub3', 'Pública 3 días', [1, 3, 5], 'HIPERTROFIA', true);
    await mk('pub2', 'Pública 2 días', [2, 4], 'FUERZA', true);
    await mk('priv', 'Privada de Ana', [1], 'FUERZA', false);
  }, 90000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const names = (body: { data: { items: Array<{ nombre: string }> } }) => body.data.items.map((i) => i.nombre);

  it('Públicas muestra las publicadas y nunca la privada de otra persona', async () => {
    const res = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&limit=20`).expect(200);
    expect(names(res.body).sort()).toEqual([`${tag} Pública 2 días`, `${tag} Pública 3 días`]);
    const all = await e2e.as(leo.token).get(`/routines?scope=public&limit=50`).expect(200);
    expect(JSON.stringify(all.body)).not.toContain('Privada de Ana');
    const mine = await e2e.as(leo.token).get(`/routines?scope=mine&q=${tag}&limit=20`).expect(200);
    expect(mine.body.data.items).toHaveLength(0);
    const shared = await e2e.as(leo.token).get(`/routines?scope=shared&limit=20`).expect(200);
    expect(JSON.stringify(shared.body)).not.toContain(tag);
  });

  it('la tarjeta trae autor, días, conteos y banderas', async () => {
    const res = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&limit=5`).expect(200);
    const card = res.body.data.items.find((c: { nombre: string }) => c.nombre.endsWith('3 días'));
    expect(card).toMatchObject({ diasPorSemana: 3, ejerciciosTotal: 3, esMia: false, esOficial: false, visibilidad: 'PUBLIC' });
    expect(card.autor).toMatchObject({ id: ana.id, nombre: 'E2E cat-ana' });
    expect(card.dias.map((d: { diaSemana: number }) => d.diaSemana)).toEqual([1, 3, 5]);
  });

  it('Mías incluye también las privadas propias', async () => {
    const res = await e2e.as(ana.token).get(`/routines?scope=mine&q=${tag}&limit=20`).expect(200);
    expect(names(res.body)).toHaveLength(3);
    expect(res.body.data.items.every((c: { esMia: boolean }) => c.esMia)).toBe(true);
  });

  it('filtra por objetivo y por días por semana, y combina los filtros', async () => {
    const goal = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&objetivo=FUERZA`).expect(200);
    expect(names(goal.body)).toEqual([`${tag} Pública 2 días`]);
    const days = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&diasPorSemana=3`).expect(200);
    expect(names(days.body)).toEqual([`${tag} Pública 3 días`]);
    const none = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&objetivo=FUERZA&diasPorSemana=3`).expect(200);
    expect(none.body.data.items).toHaveLength(0);
  });

  it('«De mi gimnasio» filtra por el gimnasio del autor', async () => {
    const res = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&deMiGimnasio=true`).expect(200);
    expect(res.body.data.items.length).toBe(2); // mismo gimnasio de pruebas
  });

  it('los tres órdenes responden y el cursor recorre sin repetir ni saltar', async () => {
    for (const orden of ['recientes', 'valoradas', 'populares']) {
      await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&orden=${orden}`).expect(200);
    }
    const first = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&limit=1`).expect(200);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.data.siguienteCursor).toBeTruthy();
    const second = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&limit=1&cursor=${first.body.data.siguienteCursor}`).expect(200);
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
    expect(second.body.data.siguienteCursor).toBeNull();
  });

  it('la búsqueda trata % y _ como texto, no como comodines', async () => {
    const res = await e2e.as(leo.token).get(`/routines?scope=public&q=${encodeURIComponent('%')}`).expect(200);
    expect(res.body.data.items).toHaveLength(0);
  });

  it('un valor inválido responde 400', async () => {
    await e2e.as(leo.token).get('/routines?scope=public&orden=inventado').expect(400);
    await e2e.as(leo.token).get('/routines?scope=public&limit=500').expect(400);
  });

  it('compatibilidad: sin limit ni cursor, mine/templates siguen paginando por página', async () => {
    const legacy = await e2e.as(ana.token).get('/routines?scope=mine&page=1&pageSize=50').expect(200);
    expect(legacy.body.data).toMatchObject({ page: 1, pageSize: 50 });
    expect(typeof legacy.body.data.total).toBe('number');
    const templates = await e2e.as(leo.token).get('/routines?scope=templates&pageSize=50').expect(200);
    expect(templates.body.data.items.some((r: { nombre: string }) => r.nombre.includes(tag))).toBe(true);
  });
});
