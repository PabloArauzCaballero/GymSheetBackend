import { bootE2eApp, E2eApp } from './support/e2e-app';

/**
 * Noche 2026-10-13 · D8: buscador de ejercicios tolerante (acentos, erratas,
 * sinónimos), «¿Quisiste decir…?», imagen por ejercicio, filtros y atajos.
 *
 * Los ejercicios son personales del usuario de la prueba y llevan una palabra
 * inventada (`tag`), así el resultado no depende de qué catálogo tenga la base.
 */
describe('Exercises · búsqueda tolerante (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  const tag = `zq${Date.now().toString(36)}`;
  // Palabra inventada que sí existirá en el catálogo global (para la sugerencia).
  const rare = `korvateo${Date.now().toString(36).slice(-4)}`;
  const ids: Record<string, string> = {};

  type Item = { id: string; nombre: string; imagenUrl: string | null };
  type Page = { items: Item[]; total: number; totalPages: number; sugerencia: string | null; consulta: string | null };

  const search = async (token: string, query: string): Promise<Page> => {
    const res = await e2e.as(token).get(`/exercises?${query}`).expect(200);
    return res.body.data as Page;
  };
  const names = (page: Page) => page.items.map((item) => item.nombre);

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('search-ana');
    leo = await e2e.register('search-leo');
    const api = e2e.as(ana.token);
    const create = async (key: string, nombre: string, grupoMuscular: string) => {
      const res = await api.post('/exercises/personal').send({ nombre, grupoMuscular }).expect(201);
      ids[key] = res.body.data.id as string;
    };
    await create('squat', `Sentadilla búlgara ${tag}`, 'Glúteos');
    await create('bench', `Press de banca ${tag}`, 'Pecho');
    await create('pull', `Dominada supina ${tag}`, 'Espalda');
    await create('curl', `Curl martillo ${tag}`, 'Bíceps');

    // Dos ejercicios globales con una palabra rara: alimentan el vocabulario de
    // la sugerencia (una palabra que aparece una sola vez no se propone).
    const admin = await e2e.register('search-admin');
    await e2e.promote(admin.id, 'ADMIN');
    for (const nombre of [`${rare} frontal`, `${rare} lateral`]) {
      await e2e.as(admin.token).post('/admin/exercises/global').send({ nombre, grupoMuscular: 'Hombros' }).expect(201);
    }
  }, 90000);

  afterAll(async () => {
    await e2e.sql(`UPDATE public.ejercicios SET estado = 'INACTIVO' WHERE nombre LIKE :rare`, { rare: `${rare}%` });
    await e2e.app?.close();
  });

  it('ignora acentos y mayúsculas', async () => {
    const page = await search(ana.token, `search=${encodeURIComponent(`SENTADILLA BULGARA ${tag}`)}`);
    expect(names(page)).toEqual([`Sentadilla búlgara ${tag}`]);
    expect(page.consulta).toBe(`sentadilla bulgara ${tag}`);
  });

  it('tolera una errata por palabra', async () => {
    expect(names(await search(ana.token, `search=${encodeURIComponent(`sentadiya ${tag}`)}`))).toContain(
      `Sentadilla búlgara ${tag}`,
    );
    expect(names(await search(ana.token, `search=${encodeURIComponent(`martiyo ${tag}`)}`))).toContain(
      `Curl martillo ${tag}`,
    );
  });

  it('encuentra por el principio de la palabra mientras se teclea', async () => {
    expect(names(await search(ana.token, `search=${encodeURIComponent(`sentad ${tag}`)}`))).toEqual([
      `Sentadilla búlgara ${tag}`,
    ]);
  });

  it('entiende sinónimos coloquiales en español e inglés', async () => {
    const found = async (query: string) => names(await search(ana.token, `search=${encodeURIComponent(`${query} ${tag}`)}`));
    expect(await found('pull up')).toEqual([`Dominada supina ${tag}`]);
    expect(await found('dominadas')).toEqual([`Dominada supina ${tag}`]);
    expect(await found('press banca')).toEqual([`Press de banca ${tag}`]);
    expect(await found('bench')).toEqual([`Press de banca ${tag}`]);
    expect(await found('squat')).toEqual([`Sentadilla búlgara ${tag}`]);
  });

  it('exige todas las palabras: no mezcla ejercicios que solo comparten una', async () => {
    const page = await search(ana.token, `search=${encodeURIComponent(`curl banca ${tag}`)}`);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('busca también por músculo y filtra por `musculo` en español', async () => {
    expect(names(await search(ana.token, `search=${tag}&musculo=${encodeURIComponent('glúteos')}`))).toEqual([
      `Sentadilla búlgara ${tag}`,
    ]);
    expect(names(await search(ana.token, `search=${encodeURIComponent(`biceps ${tag}`)}`))).toEqual([
      `Curl martillo ${tag}`,
    ]);
    expect((await search(ana.token, `search=${tag}&musculo=antebrazo`)).total).toBe(0);
  });

  it('pagina y ordena por nombre cuando se pide', async () => {
    const first = await search(ana.token, `search=${tag}&orden=nombre&pageSize=3&page=1`);
    expect(first.total).toBe(4);
    expect(first.totalPages).toBe(2);
    expect(names(first)).toEqual([`Curl martillo ${tag}`, `Dominada supina ${tag}`, `Press de banca ${tag}`]);
    const second = await search(ana.token, `search=${tag}&orden=nombre&pageSize=3&page=2`);
    expect(names(second)).toEqual([`Sentadilla búlgara ${tag}`]);
    const beyond = await search(ana.token, `search=${tag}&orden=nombre&pageSize=3&page=3`);
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(4);
  });

  it('no enseña los ejercicios personales de otra persona', async () => {
    expect((await search(leo.token, `search=${tag}`)).total).toBe(0);
  });

  it('propone «¿Quisiste decir…?» y ya enseña los resultados corregidos', async () => {
    const typo = `${rare.slice(0, 3)}b${rare.slice(4)}`; // una letra cambiada
    const page = await search(leo.token, `search=${typo}`);
    expect(page.sugerencia).toBe(rare);
    expect(names(page).sort()).toEqual([`${rare} frontal`, `${rare} lateral`]);
    // Bien escrito no hay nada que proponer.
    expect((await search(leo.token, `search=${rare}`)).sugerencia).toBeNull();
  });

  it('sin resultados ni corrección posible: lista vacía y sugerencia nula', async () => {
    const page = await search(ana.token, 'search=xqzwvkjh');
    expect(page).toMatchObject({ items: [], total: 0, sugerencia: null, consulta: 'xqzwvkjh' });
  });

  it('cada ejercicio trae su imagen fija y `conImagen` filtra por ella', async () => {
    const before = await search(ana.token, `search=${tag}&orden=nombre`);
    expect(before.items.every((item) => item.imagenUrl === null)).toBe(true);

    await e2e.sql(
      `INSERT INTO training.exercise_media (id, ejercicio_id, media_type, provider, url, alt_text, width, height, is_primary, sort_order, status, created_at, updated_at)
       VALUES (gen_random_uuid(), :id, 'IMAGE', 'e2e', 'https://media.e2e.test/curl.jpg', 'e2e', 1700, 1134, false, 0, 'ACTIVE', now(), now()),
              (gen_random_uuid(), :id, 'VIDEO', 'e2e', 'https://media.e2e.test/curl.mp4', 'e2e', NULL, NULL, true, 1, 'ACTIVE', now(), now())`,
      { id: ids.curl },
    );
    await e2e.sql(
      `INSERT INTO training.exercise_media (id, ejercicio_id, media_type, provider, url, thumbnail_url, alt_text, is_primary, sort_order, status, created_at, updated_at)
       VALUES (gen_random_uuid(), :id, 'VIDEO', 'e2e', 'https://media.e2e.test/pull.mp4', 'https://media.e2e.test/pull-poster.webp', 'e2e', true, 0, 'ACTIVE', now(), now())`,
      { id: ids.pull },
    );

    const after = await search(ana.token, `search=${tag}&orden=nombre`);
    const image = new Map(after.items.map((item) => [item.id, item.imagenUrl]));
    expect(image.get(ids.curl)).toBe('https://media.e2e.test/curl.jpg');
    expect(image.get(ids.pull)).toBe('https://media.e2e.test/pull-poster.webp');
    expect(image.get(ids.bench)).toBeNull();

    const onlyWithImage = await search(ana.token, `search=${tag}&conImagen=true&orden=nombre`);
    expect(names(onlyWithImage)).toEqual([`Curl martillo ${tag}`, `Dominada supina ${tag}`]);
  });

  it('la lista de siempre (sin búsqueda) sigue igual y ahora trae imagenUrl y los campos nuevos', async () => {
    const res = await e2e.as(ana.token).get('/exercises?pageSize=2').expect(200);
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 2, sugerencia: null, consulta: null });
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0]).toHaveProperty('imagenUrl');
    await e2e.as(ana.token).get('/exercises?orden=aleatorio').expect(400);
  });

  it('atajos: recientes y más usados salen de las sesiones de quien pregunta', async () => {
    const empty = await e2e.as(leo.token).get('/exercises/shortcuts').expect(200);
    expect(empty.body.data.recientes).toEqual([]);
    expect(empty.body.data.masUsados).toEqual([]);
    expect(Array.isArray(empty.body.data.populares)).toBe(true);

    const api = e2e.as(ana.token);
    const logged = async (exerciseIds: string[]) => {
      const session = await api.post('/workouts').send({}).expect(201);
      for (const [index, ejercicioId] of exerciseIds.entries()) {
        const added = await api
          .post(`/workouts/${session.body.data.id}/exercises`)
          .send({ ejercicioId, orden: index + 1 })
          .expect(201);
        await api
          .post(`/workouts/session-exercises/${added.body.data.id}/sets`)
          .send({ numeroSerie: 1, repeticiones: 8, pesoKg: 20, rir: 2, descansoSegAnterior: 0 })
          .expect(201);
      }
      await api.patch(`/workouts/${session.body.data.id}/finish`).send({}).expect(200);
    };
    await logged([ids.bench, ids.squat]);
    await logged([ids.bench]);
    // Un ejercicio añadido pero sin ninguna serie no cuenta como usado.
    const untouched = await api.post('/workouts').send({}).expect(201);
    await api.post(`/workouts/${untouched.body.data.id}/exercises`).send({ ejercicioId: ids.pull, orden: 1 }).expect(201);
    await api.patch(`/workouts/${untouched.body.data.id}/cancel`).expect(200);

    const shortcuts = await api.get('/exercises/shortcuts?limit=5').expect(200);
    const idsOf = (list: Item[]) => list.map((item) => item.id);
    expect(idsOf(shortcuts.body.data.masUsados)).toEqual([ids.bench, ids.squat]);
    expect(idsOf(shortcuts.body.data.recientes)).toEqual([ids.bench, ids.squat]);
    expect(shortcuts.body.data.masUsados[0]).toHaveProperty('imagenUrl');

    const recent = await search(ana.token, 'orden=recientes');
    expect(recent.items.map((item) => item.id)).toEqual([ids.bench, ids.squat]);
    await e2e.as(ana.token).get('/exercises/shortcuts?limit=99').expect(400);
  });
});
