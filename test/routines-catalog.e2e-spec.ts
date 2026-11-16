import { RoutineCatalogRepository } from '../src/modules/training/routine-catalog.repository';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-01 · catálogo por pestañas: públicas, mías, compartidas; filtros, orden y cursor. */
describe('Routines v2 · catalog (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  const tag = `cat${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const fixtureIds: string[] = [];
  /**
   * The legacy list orders by `updated_at DESC, id ASC` over the whole shared
   * base, and walking every page trips the rate limiter. Moving this run's few
   * fixtures an hour ahead makes them page 1; afterAll puts them back.
   */
  const bumpToFirstPage = async (routineIds: string[]) => {
    fixtureIds.push(...routineIds);
    await e2e.sql(`UPDATE training.routines SET updated_at = now() + interval '1 hour' WHERE id IN (:ids)`, { ids: routineIds });
  };

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
    await bumpToFirstPage(Object.values(ids));
  }, 90000);

  afterAll(async () => {
    await e2e?.sql(`UPDATE training.routines SET updated_at = now() WHERE updated_at > now() AND id IN (:ids)`, {
      ids: [...Object.values(ids), ...fixtureIds],
    }).catch(() => undefined);
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
       SELECT gen_random_uuid(), re.ejercicio_id, 'VIDEO', 'EXTERNAL_URL', 'https://media.e2e.test/v.mp4', 'https://media.e2e.test/poster.webp', 'e2e', true, 0, 'ACTIVE', now(), now()
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
                   VALUES (gen_random_uuid(), :e, :type, 'EXTERNAL_URL', :url, NULL, :width, 'e2e', :primary, :orden, 'ACTIVE', now(), now())`;
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

  it('Todas junta lo público con lo propio: Ana ve sus 3, Leo solo las 2 públicas', async () => {
    const ana3 = await e2e.as(ana.token).get(`/routines?scope=all&q=${tag}&limit=20`).expect(200);
    expect(names(ana3.body)).toHaveLength(3);
    const leo2 = await e2e.as(leo.token).get(`/routines?scope=all&q=${tag}&limit=20`).expect(200);
    expect(names(leo2.body).sort()).toEqual([`${tag} Pública 2 días`, `${tag} Pública 3 días`]);
    expect(JSON.stringify(leo2.body)).not.toContain('Privada de Ana');
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
    const templates = await e2e.as(leo.token).get('/routines?scope=templates&pageSize=100').expect(200);
    expect(templates.body.data.items.some((r: { nombre: string }) => r.nombre.includes(tag))).toBe(true);
  });
  describe('compatibilidad: «Explorar rutinas» del móvil (scope=public&page&pageSize)', () => {
    type Full = { id: string; nombre: string; creadoPorUsuarioId: string; estado: string; ejercicios: unknown[]; dias: unknown[]; objetivo: string | null };
    /** The fixtures were moved to the top of `updated_at DESC, id ASC`, so page 1 holds them whatever the shared base contains. */
    const allPages = async (token: string, query: string): Promise<Full[]> => {
      const res = await e2e.as(token).get(`/routines?${query}&pageSize=100&page=1`).expect(200);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 100 });
      return res.body.data.items as Full[];
    };

    it('recibe la rutina completa, nunca la privada de otra persona', async () => {
      const items = await allPages(leo.token, 'scope=public');
      const ids3 = items.map((r) => r.id);
      expect(ids3).toEqual(expect.arrayContaining([ids.pub3, ids.pub2]));
      expect(ids3).not.toContain(ids.priv);
      const three = items.find((r) => r.id === ids.pub3)!;
      expect(three).toMatchObject({ creadoPorUsuarioId: ana.id, estado: 'ACTIVE' });
      expect(three.ejercicios).toHaveLength(3);
      expect(three.dias).toHaveLength(3);
    });

    it('filtra por goal en public y en mine', async () => {
      const pub = await allPages(leo.token, 'scope=public&goal=FUERZA');
      expect(pub.every((r) => r.objetivo === 'FUERZA')).toBe(true);
      expect(pub.map((r) => r.id)).toContain(ids.pub2);
      expect(pub.map((r) => r.id)).not.toContain(ids.pub3);
      const mine = await allPages(ana.token, 'scope=mine&goal=FUERZA');
      expect(mine.map((r) => r.id).sort()).toEqual([ids.pub2, ids.priv].sort());
    });

    it('un filtro del catálogo manda la petición al catálogo aunque traiga page', async () => {
      const res = await e2e.as(leo.token).get(`/routines?scope=public&page=2&q=${tag}&objetivo=FUERZA`).expect(200);
      expect(res.body.data).toHaveProperty('siguienteCursor');
      expect(names(res.body)).toEqual([`${tag} Pública 2 días`]);
    });

    it('valida sus parámetros: pageSize > 100 y goal desconocido responden 400', async () => {
      await e2e.as(leo.token).get('/routines?scope=public&pageSize=101&page=1').expect(400);
      await e2e.as(leo.token).get('/routines?scope=public&pageSize=20&page=1&goal=INVALID').expect(400);
    });
  });

  /**
   * Discovery rule shared by the web catalog (cursor) and mobile «Explorar»
   * (legacy page list), see src/modules/training/routine-discovery.ts. Every
   * fixture is set up first and each viewer's lists are read once.
   */
  describe('descubrimiento: reportadas, bloqueos y gimnasio (web y móvil)', () => {
    const t2 = `dsc${Date.now().toString(36)}`;
    const otherGym = 'e2e-otro-gym';
    const d: Record<string, string> = {};
    type Person = { token: string; id: string };
    type Views = { web: string[]; all: string[]; official: string[]; mine: string[]; mobile: string[]; templates: string[]; recommended: string[] };
    const people: Record<string, Person> = {};
    const views: Record<string, Views> = {};
    const reportStatus: Record<string, number> = {};

    const publish = async (who: Person, key: string): Promise<void> => {
      const api = e2e.as(who.token);
      const ex = await createPersonalExercise(api, `${t2} ${key}`);
      const res = await api
        .post('/routines')
        .send({ nombre: `${t2} ${key}`, objetivo: 'FUERZA', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: ex }] }] })
        .expect(201);
      d[key] = res.body.data.id;
      await api.post(`/routines/${d[key]}/publish`).expect(201);
    };
    const makeOfficial = (key: string) =>
      e2e.sql(`UPDATE training.routines SET es_oficial = true, metadata = metadata || jsonb_build_object('plantilla', CAST(:p AS text)) WHERE id = :id`, {
        id: d[key],
        p: `${t2}-${key}`,
      });
    const adultWithCrossGym = async (id: string, edad: number) => {
      await e2e.sql(
        `INSERT INTO public.perfiles_antropometricos (usuario_id, edad, peso_kg, estatura_cm, objetivo)
         VALUES (:id, :edad, 70, 175, 'HIPERTROFIA') ON CONFLICT (usuario_id) DO UPDATE SET edad = :edad, fecha_nacimiento = NULL`,
        { id, edad },
      );
      await e2e.sql(
        `INSERT INTO social.profile_settings (user_id, profile_enabled, cross_gym_enabled) VALUES (:id, true, true)
         ON CONFLICT (user_id) DO UPDATE SET profile_enabled = true, cross_gym_enabled = true`,
        { id },
      );
    };

    /** Ids the viewer gets from each path the apps use. */
    const read = async (token: string, viewerId: string): Promise<Views> => {
      const ids = (b: { data: Array<{ id: string }> | { items: Array<{ id: string }> } }) =>
        (Array.isArray(b.data) ? b.data : b.data.items).map((i) => i.id);
      const tab = async (q: string) => ids((await e2e.as(token).get(`/routines?${q}&q=${t2}&limit=50`).expect(200)).body);
      // Page 1 only: the fixtures were bumped to the top of the legacy order (bumpToFirstPage).
      const pages = async (scope: string) =>
        ids((await e2e.as(token).get(`/routines?scope=${scope}&pageSize=100&page=1`).expect(200)).body);
      // «Para ti» picks among these by profile; asserting on its source keeps the case deterministic.
      const templates = await e2e.app.get(RoutineCatalogRepository).listOfficialTemplates(viewerId);
      await e2e.as(token).get('/routines/recommended').expect(200);
      return {
        web: await tab('scope=public'),
        all: await tab('scope=all'),
        official: await tab('scope=official'),
        mine: await tab('scope=public&deMiGimnasio=true'),
        mobile: await pages('public'),
        templates: await pages('templates'),
        recommended: templates.map((row) => row.id),
      };
    };

    beforeAll(async () => {
      for (const label of ['rita', 'bea', 'tom', 'carla', 'pablo', 'mino', 'sus']) {
        people[label] = await e2e.register(`dsc-${label}`);
      }
      const { rita, bea, tom, carla, pablo, mino, sus } = people;
      await e2e.sql(`INSERT INTO public.tenants (id, nombre) VALUES (:id, 'Otro gimnasio') ON CONFLICT (id) DO NOTHING`, { id: otherGym });
      await e2e.sql(`UPDATE public.usuarios SET tenant_id = :g WHERE id IN (:ids)`, { g: otherGym, ids: [carla.id, pablo.id, mino.id, sus.id] });
      // Pablo and Sus are adults who opened cross-gym discovery; Mino too, but is 16; Carla did not.
      await adultWithCrossGym(pablo.id, 30);
      await adultWithCrossGym(sus.id, 30);
      await adultWithCrossGym(mino.id, 16);

      await publish(ana, 'reportada');
      await publish(bea, 'de-bea');
      await publish(carla, 'otro-gym');
      await publish(pablo, 'otro-gym-consentida');
      await publish(mino, 'otro-gym-menor');
      await publish(sus, 'otro-gym-suspendida');
      await publish(carla, 'oficial');
      await publish(ana, 'oficial-reportada');
      await publish(carla, 'oficial-otro-gym-reportada');
      await publish(bea, 'oficial-bloqueada');
      await publish(carla, 'sin-tenant-cuenta');
      await publish(ana, 'sin-tenant-mismo-gym');
      await Promise.all(['oficial', 'oficial-reportada', 'oficial-bloqueada', 'oficial-otro-gym-reportada'].map(makeOfficial));
      // Rows without tenant_id_autor take the gym of the author's account (usuarios.tenant_id is NOT NULL,
      // so the DEFAULT_TENANT_ID fallback only mirrors the session and cannot be reached with real rows).
      await e2e.sql(`UPDATE training.routines SET tenant_id_autor = NULL WHERE id IN (:ids)`, { ids: [d['sin-tenant-cuenta'], d['sin-tenant-mismo-gym']] });
      await e2e.sql(`UPDATE public.usuarios SET suspended_until = now() + interval '1 day' WHERE id = :id`, { id: sus.id });

      // Cross-gym reports: allowed exactly when the reporter can discover the routine.
      for (const key of ['reportada', 'oficial-reportada', 'oficial-otro-gym-reportada', 'otro-gym-consentida']) {
        reportStatus[key] = (await e2e.as(rita.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: d[key], reason: 'SPAM' })).status;
      }
      reportStatus['otro-gym-repetida'] = (
        await e2e.as(rita.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: d['oficial-otro-gym-reportada'], reason: 'PLAGIO' })
      ).status;
      reportStatus['otro-gym'] = (await e2e.as(rita.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: d['otro-gym'], reason: 'SPAM' })).status;
      await e2e.as(rita.token).post('/me/blocks').send({ targetUserId: bea.id }).expect(201);
      await e2e.as(bea.token).post('/me/blocks').send({ targetUserId: tom.id }).expect(201);

      await bumpToFirstPage(Object.values(d));
      for (const label of ['rita', 'tom', 'carla', 'pablo']) views[label] = await read(people[label].token, people[label].id);
      views.leo = await read(leo.token, leo.id);
    }, 180000);

    afterAll(async () => {
      // Keep the shared base's «Para ti» candidates to the real REPP templates.
      await e2e.sql(`UPDATE training.routines SET es_oficial = false, metadata = metadata - 'plantilla' WHERE id IN (:ids)`, {
        ids: [d.oficial, d['oficial-reportada'], d['oficial-bloqueada'], d['oficial-otro-gym-reportada']].filter(Boolean),
      });
    });

    const community = (v: Views) => [v.web, v.all, v.mobile, v.templates];
    const officialPaths = (v: Views) => [v.official, v.mobile, v.templates, v.recommended];

    it('quien reportó una rutina deja de verla; las demás personas la siguen viendo', () => {
      for (const list of community(views.rita)) expect(list).not.toContain(d.reportada);
      for (const list of community(views.leo)) expect(list).toContain(d.reportada);
    }, 30000);

    it('el bloqueo es mutuo: ni quien bloqueó ni quien fue bloqueado ve las rutinas del otro', () => {
      for (const list of [...community(views.rita), ...community(views.tom)]) expect(list).not.toContain(d['de-bea']);
      for (const list of community(views.leo)) expect(list).toContain(d['de-bea']);
    }, 30000);

    it('reportar o bloquear también oculta una oficial: pestaña Oficiales, móvil, templates y «Para ti»', () => {
      for (const list of officialPaths(views.rita)) {
        expect(list).not.toContain(d['oficial-reportada']);
        expect(list).not.toContain(d['oficial-bloqueada']);
      }
      for (const list of officialPaths(views.tom)) expect(list).not.toContain(d['oficial-bloqueada']);
      for (const list of officialPaths(views.leo)) {
        expect(list).toContain(d['oficial-reportada']);
        expect(list).toContain(d['oficial-bloqueada']);
      }
    }, 30000);

    it('otro gimnasio: solo con consentimiento de un adulto activo y sin suspensión', async () => {
      for (const list of community(views.leo)) {
        expect(list).not.toContain(d['otro-gym']);
        expect(list).toContain(d['otro-gym-consentida']);
        expect(list).not.toContain(d['otro-gym-menor']);
        expect(list).not.toContain(d['otro-gym-suspendida']);
      }
      // Its own gym still discovers them, and the author keeps hers in «Todas».
      for (const list of community(views.pablo)) {
        expect(list).toContain(d['otro-gym']);
        expect(list).toContain(d['otro-gym-menor']);
      }
      expect(views.carla.all).toContain(d['otro-gym']);
      // «De mi gimnasio» narrows further to the viewer's gym.
      expect(views.leo.mine).not.toContain(d['otro-gym-consentida']);
      // Listing is not access: the detail by id is unchanged.
      await e2e.as(leo.token).get(`/routines/${d['otro-gym']}`).expect(200);
    }, 30000);

    it('sin tenant_id_autor, el gimnasio sale de la cuenta del autor (también en «De mi gimnasio»)', () => {
      for (const list of [...community(views.leo), views.leo.mine]) {
        expect(list).not.toContain(d['sin-tenant-cuenta']);
        expect(list).toContain(d['sin-tenant-mismo-gym']);
      }
      for (const list of [...community(views.pablo), views.pablo.mine]) {
        expect(list).toContain(d['sin-tenant-cuenta']);
        expect(list).not.toContain(d['sin-tenant-mismo-gym']);
      }
    }, 30000);

    it('lo que se ve desde otro gimnasio se puede denunciar, y desaparece para quien denunció', () => {
      expect(reportStatus).toEqual({
        reportada: 201,
        'oficial-reportada': 201,
        'oficial-otro-gym-reportada': 201,
        'otro-gym-consentida': 201,
        'otro-gym-repetida': 409, // a repeated open report still answers 409
        'otro-gym': 404, // not discoverable from the reporter's gym
      });
      for (const list of officialPaths(views.rita)) expect(list).not.toContain(d['oficial-otro-gym-reportada']);
      for (const list of community(views.rita)) expect(list).not.toContain(d['otro-gym-consentida']);
      for (const list of officialPaths(views.leo)) expect(list).toContain(d['oficial-otro-gym-reportada']);
    }, 30000);

    it('una rutina oficial de REPP se ve desde cualquier gimnasio', () => {
      for (const list of officialPaths(views.leo)) expect(list).toContain(d.oficial);
      expect(views.leo.web).not.toContain(d.oficial); // officials have their own tab on the web
    }, 30000);
  });
});
