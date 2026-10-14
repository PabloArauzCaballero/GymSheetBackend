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

  it('la tarjeta y el detalle traen la foto del autor y la portada; una foto moderada no sale', async () => {
    type Card = { nombre: string; portadaUrl: string | null; autor: { fotoUrl: string | null } };
    const card = async (): Promise<Card | undefined> => {
      const res = await e2e.as(leo.token).get(`/routines?scope=public&q=${tag}&limit=5`).expect(200);
      return (res.body.data.items as Card[]).find((c) => c.nombre.endsWith('3 días'));
    };
    const before = await card();
    expect(before?.autor.fotoUrl).toBeNull();
    expect(before?.portadaUrl).toBeNull();

    await e2e.sql(
      `INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key, position, created_at)
       VALUES (gen_random_uuid(), :id, 'https://media.e2e.test/oculta.jpg', 'minio', :k1, 0, now()),
              (gen_random_uuid(), :id, 'https://media.e2e.test/ana.jpg', 'minio', :k2, 1, now())`,
      { id: ana.id, k1: `${tag}-a`, k2: `${tag}-b` },
    );
    await e2e.sql(`UPDATE profile.photos SET hidden_at = now() WHERE storage_key = :k`, { k: `${tag}-a` });
    await e2e.sql(
      `INSERT INTO training.exercise_media (id, ejercicio_id, media_type, provider, url, thumbnail_url, alt_text, is_primary, sort_order, status, created_at, updated_at)
       SELECT gen_random_uuid(), re.ejercicio_id, 'VIDEO', 'e2e', 'https://media.e2e.test/v.mp4', 'https://media.e2e.test/poster.webp', 'e2e', true, 0, 'ACTIVE', now(), now()
         FROM training.routine_exercises re WHERE re.routine_id = :r LIMIT 1`,
      { r: ids.pub3 },
    );
    const after = await card();
    expect(after?.autor.fotoUrl).toBe('https://media.e2e.test/ana.jpg');
    expect(after?.portadaUrl).toBe('https://media.e2e.test/poster.webp');

    const detail = await e2e.as(leo.token).get(`/routines/${ids.pub3}`).expect(200);
    expect(detail.body.data.portadaUrl).toBe('https://media.e2e.test/poster.webp');
    expect(detail.body.data.autor).toEqual({ id: ana.id, nombre: 'E2E cat-ana', fotoUrl: 'https://media.e2e.test/ana.jpg' });
  });

  it('el detalle da una imagen fija por ejercicio y una portada por día; gana la lámina nítida', async () => {
    const api = e2e.as(ana.token);
    const [bare, blurry, sharp] = await Promise.all(['sin', '850', '1700'].map((k) => createPersonalExercise(api, `${tag} still ${k}`)));
    const created = await api
      .post('/routines')
      .send({
        // Sin `tag`: los demás casos buscan por él y cuentan las rutinas de Ana.
        nombre: `Láminas e2e ${Date.now().toString(36).split('').reverse().join('')}`,
        dias: [
          { diaSemana: 1, ejercicios: [{ ejercicioId: bare }, { ejercicioId: blurry }] },
          { diaSemana: 3, ejercicios: [{ ejercicioId: sharp }] },
          { diaSemana: 5, ejercicios: [{ ejercicioId: bare }] },
        ],
      })
      .expect(201);
    const media = `INSERT INTO training.exercise_media (id, ejercicio_id, media_type, provider, url, thumbnail_url, width, alt_text, is_primary, sort_order, status, created_at, updated_at)
                   VALUES (gen_random_uuid(), :e, :type, 'e2e', :url, NULL, :width, 'e2e', :primary, :orden, 'ACTIVE', now(), now())`;
    // Vídeo principal SIN póster + lámina de 850 px: antes el detalle no enseñaba ninguna imagen de este ejercicio.
    await e2e.sql(media, { e: blurry, type: 'VIDEO', url: 'https://media.e2e.test/sin-poster.mp4', width: null, primary: true, orden: 0 });
    await e2e.sql(media, { e: blurry, type: 'IMAGE', url: 'https://media.e2e.test/lamina-850.jpg', width: 850, primary: false, orden: 50 });
    await e2e.sql(media, { e: sharp, type: 'IMAGE', url: 'https://media.e2e.test/lamina-1700.jpg', width: 1700, primary: true, orden: 0 });

    type Item = { ejercicio: { id: string; imagenUrl: string | null; media: Array<{ mediaType: string; thumbnailUrl: string | null }> } };
    const detail = (await api.get(`/routines/${created.body.data.id}`).expect(200)).body.data as {
      portadaUrl: string | null;
      dias: Array<{ portadaUrl: string | null; ejercicios: Item[] }>;
    };
    const [monday, wednesday, friday] = detail.dias;
    expect(monday.ejercicios.map((e) => e.ejercicio.imagenUrl)).toEqual([null, 'https://media.e2e.test/lamina-850.jpg']);
    expect(monday.ejercicios[1].ejercicio.media[0]).toMatchObject({ mediaType: 'VIDEO', thumbnailUrl: 'https://media.e2e.test/lamina-850.jpg' });
    // La portada del día salta el ejercicio sin imagen; un día sin ninguna queda en null.
    expect(monday.portadaUrl).toBe('https://media.e2e.test/lamina-850.jpg');
    expect(wednesday.portadaUrl).toBe('https://media.e2e.test/lamina-1700.jpg');
    expect(friday.portadaUrl).toBeNull();
    // Portada de la rutina: la lámina de ancho nítido antes que la de 850 px, aunque esta vaya primero.
    expect(detail.portadaUrl).toBe('https://media.e2e.test/lamina-1700.jpg');
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
