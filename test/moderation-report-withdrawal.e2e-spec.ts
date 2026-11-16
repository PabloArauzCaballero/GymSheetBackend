import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

type Person = { token: string; id: string };

/** «Tus denuncias»: listing your reports and withdrawing one (web catalog + mobile Explorar). */
describe('Withdrawing a report (e2e)', () => {
  let e2e: E2eApp;
  let ana: Person;
  let rita: Person;
  let leo: Person;
  let admin: Person;
  const reporters: Person[] = [];
  const tag = `wdr${Date.now().toString(36)}`;
  const routines: Record<string, string> = {};

  const row = async <T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T> => {
    const [found] = await e2e.app.get(Sequelize).query<T>(sql, { type: QueryTypes.SELECT, replacements });
    if (!found) throw new Error(`no row for ${sql}`);
    return found;
  };

  const publish = async (key: string) => {
    const api = e2e.as(ana.token);
    const ex = await createPersonalExercise(api, `${tag} ${key}`);
    const res = await api
      .post('/routines')
      .send({ nombre: `${tag} ${key}`, objetivo: 'FUERZA', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: ex }] }] })
      .expect(201);
    routines[key] = res.body.data.id as string;
    await api.post(`/routines/${routines[key]}/publish`).expect(201);
    // The legacy page list orders by updated_at over the whole base: move the fixture to page 1.
    await e2e.sql(`UPDATE training.routines SET updated_at = now() + interval '1 hour' WHERE id = :id`, { id: routines[key] });
  };

  const report = (who: Person, key: string, reason = 'SPAM') =>
    e2e.as(who.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: routines[key], reason });

  /** What the web catalog («Públicas») and mobile «Explorar rutinas» list for this person. */
  const visible = async (who: Person) => {
    const ids = (b: { data: Array<{ id: string }> | { items: Array<{ id: string }> } }) =>
      (Array.isArray(b.data) ? b.data : b.data.items).map((i) => i.id);
    const web = ids((await e2e.as(who.token).get(`/routines?scope=public&q=${tag}&limit=50`).expect(200)).body);
    const mobile = ids((await e2e.as(who.token).get('/routines?scope=public&pageSize=100&page=1').expect(200)).body);
    return { web, mobile };
  };

  const myReports = async (who: Person, query = '') =>
    (await e2e.as(who.token).get(`/me/reports${query}`).expect(200)).body.data as {
      items: Array<{ id: string; targetId: string; title: string | null; ownerName: string; status: string; createdAt: string }>;
      nextCursor: string | null;
    };

  type QueueCard = { target_id: string; reporter_count: number };
  /** The queue card of a target, walking every page (the shared e2e base holds many open cases). */
  const queueCard = async (targetId: string): Promise<QueueCard | undefined> => {
    for (let page = 1; page <= 40; page += 1) {
      const cards = (await e2e.as(admin.token).get(`/admin/moderation/queue?pageSize=50&page=${page}`).expect(200)).body
        .data as QueueCard[];
      const card = cards.find((item) => item.target_id === targetId);
      if (card || cards.length < 50) return card;
    }
    return undefined;
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('wdr-ana');
    rita = await e2e.register('wdr-rita');
    leo = await e2e.register('wdr-leo');
    admin = await e2e.register('wdr-admin');
    await e2e.promote(admin.id, 'SYSTEM_ADMIN');
    for (const label of ['wdr-p1', 'wdr-p2', 'wdr-p3']) reporters.push(await e2e.register(label));
    for (const key of ['retirada', 'umbral', 'resuelta', 'oculta-mod']) await publish(key);
  }, 120000);

  afterAll(async () => {
    await e2e?.sql(`UPDATE training.routines SET updated_at = now() WHERE id IN (:ids)`, { ids: Object.values(routines) }).catch(() => undefined);
    await e2e.app?.close();
  });

  describe('retirar la propia denuncia', () => {
    let reportId = '';

    it('denunciar la oculta para quien denunció y aparece en «Tus denuncias»', async () => {
      reportId = (await report(rita, 'retirada').expect(201)).body.data.id as string;
      const seen = await visible(rita);
      expect(seen.web).not.toContain(routines.retirada);
      expect(seen.mobile).not.toContain(routines.retirada);

      const mine = await myReports(rita);
      expect(mine.items[0]).toMatchObject({
        id: reportId,
        targetId: routines.retirada,
        title: `${tag} retirada`,
        ownerName: 'E2E wdr-ana',
        status: 'EN_REVISION',
      });
      expect(mine.items[0]).not.toHaveProperty('details');
      expect(await queueCard(routines.retirada)).toBeDefined();
    });

    it('nadie más la ve ni la puede retirar: 404 para otra persona; 401 sin sesión; 400 con un id inválido', async () => {
      expect((await myReports(leo)).items.map((i) => i.id)).not.toContain(reportId);
      await e2e.as(leo.token).post(`/me/reports/${reportId}/withdraw`).expect(404);
      await e2e.as(ana.token).post(`/me/reports/${reportId}/withdraw`).expect(404);
      await e2e.as(admin.token).post(`/me/reports/${reportId}/withdraw`).expect(404);
      await e2e.as('').post(`/me/reports/${reportId}/withdraw`).expect(401);
      await e2e.as('').get('/me/reports').expect(401);
      await e2e.as(rita.token).post('/me/reports/not-a-uuid/withdraw').expect(400);
      await e2e.as(rita.token).get('/me/reports?limit=500').expect(400);
      await e2e.as(rita.token).get('/me/reports?cursor=nope').expect(400);
      const stored = await row<{ status: string; withdrawn_at: Date | null }>(
        'SELECT status, withdrawn_at FROM moderation.reports WHERE id = :id', { id: reportId });
      expect(stored).toEqual({ status: 'PENDIENTE', withdrawn_at: null });
    });

    it('retirarla responde 200, la deja como registro RETIRADO y la rutina vuelve al catálogo web y a Explorar', async () => {
      const res = await e2e.as(rita.token).post(`/me/reports/${reportId}/withdraw`).expect(200);
      expect(res.body.data).toMatchObject({ id: reportId, withdrawn: true, contentRestored: false });

      const stored = await row<{ status: string; withdrawn_at: Date | null }>(
        'SELECT status, withdrawn_at FROM moderation.reports WHERE id = :id', { id: reportId });
      expect(stored.status).toBe('RETIRADO');
      expect(stored.withdrawn_at).not.toBeNull();

      const seen = await visible(rita);
      expect(seen.web).toContain(routines.retirada);
      expect(seen.mobile).toContain(routines.retirada);
      expect((await myReports(rita)).items.map((i) => i.id)).not.toContain(reportId);
      expect(await queueCard(routines.retirada)).toBeUndefined();

      // The moderator still sees the record, marked as withdrawn.
      const kase = await e2e.as(admin.token).get(`/admin/moderation/cases/ROUTINE/${routines.retirada}`).expect(200);
      expect(kase.body.data.reports[0]).toMatchObject({ id: reportId, status: 'RETIRADO' });
      expect(kase.body.data.reports[0].withdrawnAt).toEqual(res.body.data.withdrawnAt);
      // Nothing left open: a verdict cannot be issued on it.
      await e2e.as(admin.token).post(`/admin/moderation/cases/ROUTINE/${routines.retirada}/resolve`)
        .send({ hideContent: true, sanction: false }).expect(404);
    });

    it('retirarla otra vez no es un error: responde la misma retirada', async () => {
      const first = await row<{ withdrawn_at: Date }>('SELECT withdrawn_at FROM moderation.reports WHERE id = :id', { id: reportId });
      const again = await e2e.as(rita.token).post(`/me/reports/${reportId}/withdraw`).expect(200);
      expect(again.body.data.withdrawnAt).toEqual(new Date(first.withdrawn_at).toISOString());
    });

    it('se puede volver a denunciar: la retirada no cuenta como abierta (no hay 409)', async () => {
      const again = await report(rita, 'retirada', 'PLAGIO').expect(201);
      expect(again.body.data.id).not.toEqual(reportId);
      await report(rita, 'retirada').expect(409); // the new one is open
      const seen = await visible(rita);
      expect(seen.web).not.toContain(routines.retirada);
      expect(seen.mobile).not.toContain(routines.retirada);
      expect((await myReports(rita)).items[0]).toMatchObject({ id: again.body.data.id, status: 'EN_REVISION' });
      expect(await queueCard(routines.retirada)).toBeDefined();
    });
  });

  it('el umbral automático se levanta si las denuncias abiertas bajan de tres; la cola conserva el caso', async () => {
    const ids: string[] = [];
    for (const person of reporters) ids.push((await report(person, 'umbral').expect(201)).body.data.id as string);
    const hidden = await row<{ estado_moderacion: string }>('SELECT estado_moderacion FROM training.routines WHERE id = :id', { id: routines.umbral });
    expect(hidden.estado_moderacion).toBe('OCULTA_AUTO');
    expect((await visible(leo)).web).not.toContain(routines.umbral);

    const res = await e2e.as(reporters[0].token).post(`/me/reports/${ids[0]}/withdraw`).expect(200);
    expect(res.body.data.contentRestored).toBe(true);
    const shown = await row<{ estado_moderacion: string }>('SELECT estado_moderacion FROM training.routines WHERE id = :id', { id: routines.umbral });
    expect(shown.estado_moderacion).toBe('VISIBLE');
    const seen = await visible(leo);
    expect(seen.web).toContain(routines.umbral);
    expect(seen.mobile).toContain(routines.umbral);
    expect((await queueCard(routines.umbral))?.reporter_count).toBe(2);
  });

  describe('si moderación ya actuó, retirar solo cambia lo que ve quien denunció', () => {
    it('descartada: el veredicto queda, y la rutina vuelve a aparecerle', async () => {
      const id = (await report(rita, 'resuelta').expect(201)).body.data.id as string;
      await e2e.as(admin.token).post(`/admin/moderation/cases/ROUTINE/${routines.resuelta}/resolve`)
        .send({ hideContent: false, sanction: false }).expect(201);
      expect((await visible(rita)).web).not.toContain(routines.resuelta);
      expect((await myReports(rita)).items.find((i) => i.id === id)?.status).toBe('REVISADA');

      await e2e.as(rita.token).post(`/me/reports/${id}/withdraw`).expect(200);
      const stored = await row<{ status: string; resolution: string; withdrawn_at: Date | null }>(
        'SELECT status, resolution, withdrawn_at FROM moderation.reports WHERE id = :id', { id });
      expect(stored.status).toBe('DESCARTADO');
      expect(stored.resolution).toBe('SIN_ACCION');
      expect(stored.withdrawn_at).not.toBeNull();
      const seen = await visible(rita);
      expect(seen.web).toContain(routines.resuelta);
      expect(seen.mobile).toContain(routines.resuelta);
    });

    it('ocultada por moderación: retirar no la devuelve a nadie', async () => {
      const id = (await report(rita, 'oculta-mod').expect(201)).body.data.id as string;
      await e2e.as(admin.token).post(`/admin/moderation/cases/ROUTINE/${routines['oculta-mod']}/resolve`)
        .send({ hideContent: true, sanction: false }).expect(201);
      const res = await e2e.as(rita.token).post(`/me/reports/${id}/withdraw`).expect(200);
      expect(res.body.data.contentRestored).toBe(false);
      const stored = await row<{ estado_moderacion: string }>('SELECT estado_moderacion FROM training.routines WHERE id = :id', { id: routines['oculta-mod'] });
      expect(stored.estado_moderacion).toBe('OCULTA_MODERACION');
      expect((await visible(leo)).web).not.toContain(routines['oculta-mod']);
    });
  });

  it('retirar y resolver a la vez no choca (sin 500 ni deadlock) y el veredicto cuenta solo lo que cerró', async () => {
    const racers: Person[] = [];
    for (const label of ['wdr-r1', 'wdr-r2', 'wdr-r3']) racers.push(await e2e.register(label));
    for (let round = 0; round < 8; round += 1) {
      const key = `carrera-${round}`;
      await publish(key);
      // Seeded in SQL (filing is throttled to 20/h per client, shared by the whole suite): three
      // open reports and the automatic curtain, so both sides also touch the content row.
      const ids: string[] = [];
      for (const person of racers) {
        const [created] = await e2e.app.get(Sequelize).query<{ id: string }>(
          `INSERT INTO moderation.reports (id, tenant_id, reporter_user_id, reported_user_id, target_kind, target_id, reason)
           SELECT gen_random_uuid(), u.tenant_id, :reporter, :author, 'ROUTINE', :target, 'SPAM'
             FROM public.usuarios u WHERE u.id = :author RETURNING id`,
          { type: QueryTypes.SELECT, replacements: { reporter: person.id, author: ana.id, target: routines[key] } },
        );
        ids.push(created.id);
      }
      await e2e.sql(`UPDATE training.routines SET estado_moderacion = 'OCULTA_AUTO' WHERE id = :id`, { id: routines[key] });
      const [first, second, resolved] = await Promise.all([
        e2e.as(racers[0].token).post(`/me/reports/${ids[0]}/withdraw`),
        e2e.as(racers[1].token).post(`/me/reports/${ids[1]}/withdraw`),
        e2e.as(admin.token).post(`/admin/moderation/cases/ROUTINE/${routines[key]}/resolve`).send({ hideContent: true, sanction: false }),
      ]);
      expect([first.status, second.status, resolved.status]).toEqual([200, 200, 201]);

      const rows = await e2e.app.get(Sequelize).query<{ status: string; withdrawn_at: Date | null; resolved_at: Date | null }>(
        'SELECT status, withdrawn_at, resolved_at FROM moderation.reports WHERE target_id = :id', { type: QueryTypes.SELECT, replacements: { id: routines[key] } });
      expect(rows).toHaveLength(3);
      // Every report is either withdrawn before the verdict, or closed by it; none stays open.
      expect(rows.filter((r) => r.status === 'PENDIENTE' || r.status === 'EN_REVISION')).toHaveLength(0);
      expect(resolved.body.data.reportsClosed).toBe(rows.filter((r) => r.resolved_at !== null).length);
      const stored = await row<{ estado_moderacion: string }>('SELECT estado_moderacion FROM training.routines WHERE id = :id', { id: routines[key] });
      expect(stored.estado_moderacion).toBe('OCULTA_MODERACION');
    }
  }, 120000);

  it('«Tus denuncias» pagina por cursor sin repetir ni saltar', async () => {
    const all = await myReports(rita, '?limit=50');
    expect(all.items.length).toBeGreaterThanOrEqual(1);
    await report(rita, 'umbral', 'OTRO').expect(201);
    const full = (await myReports(rita, '?limit=50')).items.map((i) => i.id);
    expect(full.length).toBeGreaterThanOrEqual(2);
    const walked: string[] = [];
    let cursor: string | null = null as string | null;
    do {
      const page = await myReports(rita, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      walked.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(walked).toEqual(full);
  });
});
