/* eslint-disable @typescript-eslint/no-unsafe-return --
   supertest tipa los cuerpos como `any`; las aserciones los recorren tal cual. */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { bootE2eApp, E2eApp } from './support/e2e-app';

/**
 * Premios del gimnasio (P1) contra Postgres real: alta por el gimnasio, cupón
 * al conseguir el hito, stock, caducidad, canje único y aislamiento entre
 * gimnasios. Todo premio creado aquí se retira al final: los premios activos
 * alcanzan a cualquier socio del gimnasio, también a los de otras suites.
 */
describe('Progression prizes (e2e)', () => {
  let e2e: E2eApp;
  let admin: { token: string; id: string };
  let exerciseId = '';
  const created: string[] = [];
  const OTHER_GYM = 'premios-otro-gym';

  beforeAll(async () => {
    e2e = await bootE2eApp();
    admin = await e2e.register('premios-admin');
    await e2e.promote(admin.id, 'ADMIN');
    const list = await e2e.as(admin.token).get('/exercises?pageSize=1&page=1').expect(200);
    exerciseId = list.body.data.items[0].id as string;
    await e2e.sql(
      `INSERT INTO public.tenants (id, nombre, estado) VALUES (:id, 'Otro gimnasio', 'ACTIVO') ON CONFLICT (id) DO NOTHING`,
      { id: OTHER_GYM },
    );
  }, 60000);

  afterAll(async () => {
    if (created.length > 0) {
      await e2e.sql('UPDATE progression.prizes SET active = false WHERE id IN (:ids)', { ids: created });
    }
    await e2e.app?.close();
  });

  const query = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
    e2e.app.get(Sequelize).query<T>(sql, { type: QueryTypes.SELECT, replacements });

  async function createPrize(body: Record<string, unknown>) {
    const response = await e2e.as(admin.token).post('/admin/progression/prizes').send(body).expect(201);
    created.push(response.body.data.id as string);
    return response.body.data;
  }

  async function finishFirstSession(token: string) {
    const api = e2e.as(token);
    const started = await api.post('/workouts').send({}).expect(201);
    const sessionId = started.body.data.id as string;
    const ex = await api.post(`/workouts/${sessionId}/exercises`).send({ ejercicioId: exerciseId, orden: 1, esEnfasis: false }).expect(201);
    await api
      .post(`/workouts/session-exercises/${ex.body.data.id}/sets`)
      .send({ numeroSerie: 1, repeticiones: 8, pesoKg: 20, rir: 2, descansoSegAnterior: 60 })
      .expect(201);
    return (await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200)).body.data;
  }

  describe('administración', () => {
    it('validates the milestone and the input', async () => {
      const api = e2e.as(admin.token);
      await api.post('/admin/progression/prizes').send({ targetKind: 'BADGE', title: 'Sin hito' }).expect(400);
      await api.post('/admin/progression/prizes').send({ targetKind: 'BADGE', targetCode: 'NO_EXISTE_NUNCA', title: 'Nada' }).expect(400);
      await api.post('/admin/progression/prizes').send({ targetKind: 'LEVEL', targetCode: 'NO_EXISTE_NUNCA', title: 'Nada' }).expect(400);
      await api.post('/admin/progression/prizes').send({ targetKind: 'BADGE', targetCode: 'RACHA_30', title: 'X', stock: -1 }).expect(400);
      // Un gimnasio no escribe en el catálogo global.
      await api.post('/admin/progression/prizes').send({ alcance: 'GLOBAL', targetKind: 'PERFECT_WEEK', title: 'Global' }).expect(403);
    });

    it('is closed to members', async () => {
      const member = await e2e.register('premios-socio-curioso');
      await e2e.as(member.token).get('/admin/progression/prizes').expect(403);
      await e2e.as(member.token).post('/admin/progression/prizes/redeem').send({ code: 'K7M2QX' }).expect(403);
    });

    it('creates, lists, edits and retires a prize of its own gym', async () => {
      const prize = await createPrize({ targetKind: 'PERFECT_WEEK', title: 'Toalla REPP', stock: 5, validDays: 60 });
      expect(prize).toMatchObject({
        tenantId: 'default',
        targetKind: 'PERFECT_WEEK',
        targetCode: 'SEMANA_REDONDA',
        icon: 'gift-outline',
        stock: 5,
        grantedCount: 0,
        active: true,
      });
      const edited = await e2e.as(admin.token).patch(`/admin/progression/prizes/${prize.id}`).send({ title: 'Toalla REPP grande', stock: null }).expect(200);
      expect(edited.body.data).toMatchObject({ title: 'Toalla REPP grande', stock: null, validDays: 60 });
      const list = (await e2e.as(admin.token).get('/admin/progression/prizes').expect(200)).body.data;
      expect(list.some((row: { id: string }) => row.id === prize.id)).toBe(true);
      await e2e.as(admin.token).del(`/admin/progression/prizes/${prize.id}`).expect(200);
      const after = (await e2e.as(admin.token).get('/admin/progression/prizes').expect(200)).body.data;
      expect(after.find((row: { id: string }) => row.id === prize.id).active).toBe(false);
    });

    it('does not let another gym see or edit it (404)', async () => {
      const prize = await createPrize({ targetKind: 'BADGE', targetCode: 'RACHA_30', title: 'Batido' });
      const stranger = await e2e.register('premios-admin-otro');
      await e2e.promote(stranger.id, 'ADMIN');
      await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenant WHERE id = :id', { tenant: OTHER_GYM, id: stranger.id });
      await e2e.as(stranger.token).patch(`/admin/progression/prizes/${prize.id}`).send({ title: 'Mío' }).expect(404);
      const list = (await e2e.as(stranger.token).get('/admin/progression/prizes').expect(200)).body.data;
      expect(list.some((row: { id: string }) => row.id === prize.id)).toBe(false);
    });
  });

  describe('cupones', () => {
    let couponCode = '';

    it('gives a coupon when the badge is earned, once, and respects the stock', async () => {
      await createPrize({
        targetKind: 'BADGE',
        targetCode: 'PRIMERA_SESION',
        title: 'Batido de proteína gratis',
        instructions: 'Enséñalo en recepción',
        stock: 1,
      });
      const first = await e2e.register('premios-socio-1');
      const finished = await finishFirstSession(first.token);
      const prizesNow = finished.progression.prizesNow as Array<Record<string, unknown>>;
      const coupon = prizesNow.find((prize) => prize.title === 'Batido de proteína gratis');
      expect(coupon).toMatchObject({
        status: 'DISPONIBLE',
        instructions: 'Enséñalo en recepción',
        icon: 'gift-outline',
        source: { kind: 'BADGE', code: 'PRIMERA_SESION', name: 'El primer día' },
        expiresAt: null,
        redeemedAt: null,
        isNew: true,
      });
      expect(coupon!.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/u);
      couponCode = coupon!.code as string;

      // Leer otra vez no da otro cupón.
      await e2e.as(first.token).get('/me/progression').expect(200);
      const mine = (await e2e.as(first.token).get('/me/progression/prizes').expect(200)).body.data;
      expect(mine.filter((prize: { title: string }) => prize.title === 'Batido de proteína gratis')).toHaveLength(1);

      await e2e.as(first.token).post('/me/progression/acknowledge').expect(201);
      const seen = (await e2e.as(first.token).get('/me/progression').expect(200)).body.data.prizes;
      expect(seen.every((prize: { isNew: boolean }) => !prize.isNew)).toBe(true);

      // Stock de uno: la segunda persona no lo recibe.
      const second = await e2e.register('premios-socio-2');
      const other = await finishFirstSession(second.token);
      expect(other.progression.prizesNow.some((prize: { title: string }) => prize.title === 'Batido de proteína gratis')).toBe(false);
      const list = (await e2e.as(admin.token).get('/admin/progression/prizes').expect(200)).body.data;
      expect(list.find((row: { title: string; active: boolean }) => row.title === 'Batido de proteína gratis' && row.active).grantedCount).toBe(1);
    });

    it('redeems a coupon once at the front desk; a second time is 409 and an unknown code 404', async () => {
      const redeemed = await e2e
        .as(admin.token)
        .post('/admin/progression/prizes/redeem')
        .send({ code: couponCode.toLowerCase() })
        .expect(200);
      expect(redeemed.body.data).toMatchObject({ code: couponCode, status: 'CANJEADO' });
      expect(redeemed.body.data.redeemedAt).toBeTruthy();

      await e2e.as(admin.token).post('/admin/progression/prizes/redeem').send({ code: couponCode }).expect(409);
      await e2e.as(admin.token).post('/admin/progression/prizes/redeem').send({ code: 'ZZZZZZ' }).expect(404);
      await e2e.as(admin.token).post('/admin/progression/prizes/redeem').send({ code: 'O0O0O0' }).expect(400);
    });

    it('does not let another gym redeem it (404, as if it did not exist)', async () => {
      const prize = await createPrize({ targetKind: 'BADGE', targetCode: 'PRIMERA_SESION', title: 'Pase para un amigo' });
      const member = await e2e.register('premios-socio-3');
      const reward = (await finishFirstSession(member.token)).progression;
      const coupon = reward.prizesNow.find((p: { title: string }) => p.title === 'Pase para un amigo');
      expect(coupon).toBeDefined();
      const stranger = await e2e.register('premios-recepcion-otra');
      await e2e.promote(stranger.id, 'ADMIN');
      await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenant WHERE id = :id', { tenant: OTHER_GYM, id: stranger.id });
      await e2e.as(stranger.token).post('/admin/progression/prizes/redeem').send({ code: coupon.code }).expect(404);
      await e2e.sql('UPDATE progression.prizes SET active = false WHERE id = :id', { id: prize.id });
    });

    it('gives the level prize when the level is reached, and an expired coupon reads CADUCADO and cannot be redeemed', async () => {
      const member = await e2e.register('premios-socio-rango');
      // Alguien que ya estaba en el primer rango antes de que naciera el premio.
      const veteran = await e2e.register('premios-socio-veterano');
      await e2e.as(veteran.token).get('/me/progression').expect(200);
      // `member` no ha abierto la senda: el primer rango se «cruza» en su primera lectura.
      const pathCode = (await query<{ code: string }>(
        `SELECT code FROM progression.levels WHERE tenant_id IS NULL AND audience = 'ANY' AND active ORDER BY min_points LIMIT 1`,
        {},
      ))[0].code;
      await createPrize({ targetKind: 'LEVEL', targetCode: pathCode, title: 'Bienvenida', validDays: 7 });
      const prizes = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.prizes;
      const welcome = prizes.find((prize: { title: string }) => prize.title === 'Bienvenida');
      expect(welcome).toMatchObject({ status: 'DISPONIBLE', source: { kind: 'LEVEL', code: pathCode } });
      expect(new Date(welcome.expiresAt as string).getTime() - new Date(welcome.awardedAt as string).getTime()).toBe(7 * 86400000);

      await e2e.sql(`UPDATE progression.user_prizes SET expires_at = now() - interval '1 day' WHERE id = :id`, { id: welcome.id });
      const expired = (await e2e.as(member.token).get('/me/progression/prizes').expect(200)).body.data;
      expect(expired.find((prize: { id: string }) => prize.id === welcome.id).status).toBe('CADUCADO');
      await e2e.as(admin.token).post('/admin/progression/prizes/redeem').send({ code: welcome.code }).expect(409);

      // Leer otra vez no da otro, y quien ya estaba en ese rango no lo recibe: no es retroactivo.
      const again = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.prizes;
      expect(again.filter((prize: { title: string }) => prize.title === 'Bienvenida')).toHaveLength(1);
      const old = (await e2e.as(veteran.token).get('/me/progression').expect(200)).body.data.prizes;
      expect(old.some((prize: { title: string }) => prize.title === 'Bienvenida')).toBe(false);
    });

    it('gives a perfect-week prize for each perfect week', async () => {
      await createPrize({ targetKind: 'PERFECT_WEEK', title: 'Semana redonda: café', icon: 'cafe-outline' });
      const member = await e2e.register('premios-socio-redonda');
      const week = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.challenges;
      await e2e.sql('DELETE FROM progression.weekly_challenges WHERE usuario_id = :userId AND week_start = :weekStart::date', {
        userId: member.id,
        weekStart: week.weekStart,
      });
      for (const [kind, difficulty, points] of [
        ['SESSIONS', 'FACIL', 60],
        ['SETS', 'MEDIO', 100],
        ['VOLUME_KG', 'DIFICIL', 160],
      ] as const) {
        await e2e.sql(
          `INSERT INTO progression.weekly_challenges (usuario_id, week_start, code, kind, difficulty, target, points_reward)
           VALUES (:userId, :weekStart::date, :kind, :kind, :difficulty, 1, :points)`,
          { userId: member.id, weekStart: week.weekStart, kind, difficulty, points },
        );
      }
      const reward = (await finishFirstSession(member.token)).progression;
      expect(reward.perfectWeekNow).toBe(true);
      const coffee = reward.prizesNow.find((prize: { title: string }) => prize.title === 'Semana redonda: café');
      expect(coffee).toMatchObject({ icon: 'cafe-outline', source: { kind: 'PERFECT_WEEK', code: 'SEMANA_REDONDA', name: 'Semana redonda' } });
      const rows = await query<{ source_ref: string }>(
        `SELECT up.source_ref FROM progression.user_prizes up WHERE up.id = :id`,
        { id: coffee.id },
      );
      expect(rows[0].source_ref).toBe(week.weekStart);
    });
  });
});
