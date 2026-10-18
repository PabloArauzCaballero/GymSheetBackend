/* eslint-disable @typescript-eslint/no-unsafe-return --
   supertest tipa los cuerpos como `any`; las aserciones los recorren tal cual. */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { bootE2eApp, E2eApp } from './support/e2e-app';

/**
 * Retos de la semana (P2) contra Postgres real: generación al ver la semana,
 * persistencia, medición de una sesión de verdad, semana redonda, novedades y
 * revisión de la semana anterior.
 *
 * Los retos generados dependen del sorteo; para medir sin depender de él, las
 * pruebas de cumplimiento reescriben las tres filas de la semana con objetivos
 * conocidos. La generación en sí se prueba aparte, sin tocarla.
 */
describe('Progression weekly challenges (e2e)', () => {
  let e2e: E2eApp;
  let exerciseId = '';

  beforeAll(async () => {
    e2e = await bootE2eApp();
    const someone = await e2e.register('retos-catalogo');
    const list = await e2e.as(someone.token).get('/exercises?pageSize=1&page=1').expect(200);
    exerciseId = list.body.data.items[0].id as string;
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const query = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
    e2e.app.get(Sequelize).query<T>(sql, { type: QueryTypes.SELECT, replacements });

  /** Sustituye los retos de la semana por tres conocidos. */
  async function setWeek(userId: string, weekStart: string, rows: Array<[string, string, number, number]>) {
    await e2e.sql('DELETE FROM progression.weekly_challenges WHERE usuario_id = :userId AND week_start = :weekStart::date', {
      userId,
      weekStart,
    });
    for (const [kind, difficulty, target, points] of rows) {
      await e2e.sql(
        `INSERT INTO progression.weekly_challenges (usuario_id, week_start, code, kind, difficulty, target, points_reward)
         VALUES (:userId, :weekStart::date, :kind, :kind, :difficulty, :target, :points)`,
        { userId, weekStart, kind, difficulty, target, points },
      );
    }
  }

  async function trainNow(token: string, sets: Array<[number, number]>) {
    const api = e2e.as(token);
    const started = await api.post('/workouts').send({}).expect(201);
    const sessionId = started.body.data.id as string;
    const ex = await api.post(`/workouts/${sessionId}/exercises`).send({ ejercicioId: exerciseId, orden: 1, esEnfasis: false }).expect(201);
    for (const [index, [reps, kg]] of sets.entries()) {
      await api
        .post(`/workouts/session-exercises/${ex.body.data.id}/sets`)
        .send({ numeroSerie: index + 1, repeticiones: reps, pesoKg: kg, rir: 2, descansoSegAnterior: 60 })
        .expect(201);
    }
    return (await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200)).body.data;
  }

  it('gives three challenges on the first look at the week, stores them and repeats them on the next look', async () => {
    const member = await e2e.register('retos-nuevo');
    const first = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.challenges;

    expect(first.items).toHaveLength(3);
    expect(first.items.map((item: { difficulty: string }) => item.difficulty)).toEqual(['FACIL', 'MEDIO', 'DIFICIL']);
    expect(first.items.map((item: { pointsReward: number }) => item.pointsReward)).toEqual([60, 100, 160]);
    expect(new Set(first.items.map((item: { kind: string }) => item.kind)).size).toBe(3);
    expect(first).toMatchObject({ completedCount: 0, perfect: false, perfectBonus: 150, perfectIsNew: false });
    // Lunes de la semana local y fin el lunes siguiente a medianoche local.
    expect(new Date(`${first.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    const nextMonday = new Date(`${first.weekStart}T00:00:00Z`);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    const localEnd = new Intl.DateTimeFormat('en-CA', { timeZone: env.BUSINESS_TIME_ZONE, hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(first.endsAt as string));
    expect(localEnd).toBe(`${nextMonday.toISOString().slice(0, 10)}, 00`);
    for (const item of first.items) {
      expect(item).toMatchObject({ current: 0, progress: 0, completed: false, completedAt: null, isNew: false });
      expect(typeof item.title).toBe('string');
      expect(item.progressLabel).toMatch(/^0( kg| min)? \/ /u);
    }

    const stored = await query<{ code: string }>(
      'SELECT code FROM progression.weekly_challenges WHERE usuario_id = :userId AND week_start = :weekStart::date',
      { userId: member.id, weekStart: first.weekStart },
    );
    expect(stored).toHaveLength(3);

    const second = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.challenges;
    expect(second.items.map((item: { code: string; target: number }) => [item.code, item.target])).toEqual(
      first.items.map((item: { code: string; target: number }) => [item.code, item.target]),
    );
  });

  it('measures a real session, closes the perfect week and pays it in the session reward', async () => {
    const member = await e2e.register('retos-redonda');
    const week = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.challenges;
    await setWeek(member.id, week.weekStart, [
      ['SESSIONS', 'FACIL', 1, 60],
      ['SETS', 'MEDIO', 3, 100],
      ['VOLUME_KG', 'DIFICIL', 500, 160],
    ]);

    const finished = await trainNow(member.token, [
      [10, 20],
      [10, 20],
      [10, 20],
    ]);
    const reward = finished.progression;

    expect(reward.challenges).toMatchObject({ completedCount: 3, perfect: true, perfectIsNew: true });
    expect(reward.challengesCompletedNow.map((item: { code: string }) => item.code).sort()).toEqual(['SESSIONS', 'SETS', 'VOLUME_KG']);
    expect(reward.perfectWeekNow).toBe(true);
    // 60 + 100 + 160 + 150 de la semana redonda: la foto previa no los contaba.
    expect(reward.breakdown.challenges).toBe(470);
    expect(reward.streak).toMatchObject({ current: 1, freezes: 0, freezeEarnedNow: false, milestoneNow: null });
    expect(Array.isArray(reward.nearest)).toBe(true);
    expect(reward.nearest.length).toBeLessThanOrEqual(3);
    expect(reward.unlockedNow.map((badge: { code: string }) => badge.code)).toContain('PRIMER_RETO');

    const volume = reward.challenges.items.find((item: { kind: string }) => item.kind === 'VOLUME_KG');
    expect(volume).toMatchObject({ current: 500, progress: 1, progressLabel: '500 kg / 500 kg', completed: true, isNew: true });

    const senda = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data;
    expect(senda.challenges).toMatchObject({ perfect: true, perfectIsNew: true });
    expect(senda.badges.find((badge: { code: string }) => badge.code === 'PRIMER_RETO')).toMatchObject({
      earned: true,
      chain: 'CHALLENGES_COMPLETED',
      chainStep: 1,
      chainLength: 4,
    });

    await e2e.as(member.token).post('/me/progression/acknowledge').expect(201);
    const seen = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data;
    expect(seen.challenges.perfectIsNew).toBe(false);
    expect(seen.challenges.items.every((item: { isNew: boolean }) => !item.isNew)).toBe(true);
    // Los puntos de los retos se quedan: verlos no los cambia.
    expect(seen.points).toBe(senda.points);
  });

  it('a partly met week shows the half-filled bar and pays only what was met', async () => {
    const member = await e2e.register('retos-medio');
    const week = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.challenges;
    await setWeek(member.id, week.weekStart, [
      ['SESSIONS', 'FACIL', 1, 60],
      ['SETS', 'MEDIO', 4, 100],
      ['VOLUME_KG', 'DIFICIL', 100000, 160],
    ]);

    const reward = (await trainNow(member.token, [[5, 10], [5, 10]])).progression;
    expect(reward.challenges).toMatchObject({ completedCount: 1, perfect: false });
    expect(reward.perfectWeekNow).toBe(false);
    expect(reward.breakdown.challenges).toBe(60);
    const sets = reward.challenges.items.find((item: { kind: string }) => item.kind === 'SETS');
    expect(sets).toMatchObject({ current: 2, progress: 0.5, progressLabel: '2 / 4', completed: false });
  });

  it('closes an open challenge of last week with a session that belonged to last week', async () => {
    const member = await e2e.register('retos-semana-pasada');
    const week = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data.challenges;
    const previousMonday = new Date(`${week.weekStart}T00:00:00Z`);
    previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
    const previousWeek = previousMonday.toISOString().slice(0, 10);
    await setWeek(member.id, previousWeek, [
      ['SESSIONS', 'FACIL', 1, 60],
      ['SETS', 'MEDIO', 50, 100],
      ['VOLUME_KG', 'DIFICIL', 100000, 160],
    ]);
    // Una sesión del miércoles pasado que llega tarde (sincronizada hoy).
    await e2e.sql(
      `INSERT INTO public.sesiones_entrenamiento (id, usuario_id, fecha_inicio, fecha_fin, estado, created_at, updated_at)
       VALUES (gen_random_uuid(), :userId, (:day::date + time '12:00') AT TIME ZONE :tz, (:day::date + time '13:00') AT TIME ZONE :tz, 'FINALIZADA', now(), now())`,
      { userId: member.id, day: new Date(previousMonday.getTime() + 2 * 86400000).toISOString().slice(0, 10), tz: env.BUSINESS_TIME_ZONE },
    );

    const before = (await e2e.as(member.token).get('/me/progression').expect(200)).body.data;
    const rows = await query<{ code: string; done: boolean }>(
      `SELECT code, completed_at IS NOT NULL AS done FROM progression.weekly_challenges
        WHERE usuario_id = :userId AND week_start = :weekStart::date ORDER BY code`,
      { userId: member.id, weekStart: previousWeek },
    );
    expect(rows).toEqual([
      { code: 'SESSIONS', done: true },
      { code: 'SETS', done: false },
      { code: 'VOLUME_KG', done: false },
    ]);
    // Cuenta para los retos cumplidos de la historia.
    expect(before.badges.find((badge: { code: string }) => badge.code === 'PRIMER_RETO')?.earned).toBe(true);
  });

  it('publishes the challenge and freeze rules', async () => {
    const member = await e2e.register('retos-reglas');
    const rules = (await e2e.as(member.token).get('/me/progression/rules').expect(200)).body.data;
    expect(rules).toMatchObject({
      perSession: 50,
      challengePoints: { FACIL: 60, MEDIO: 100, DIFICIL: 160 },
      perfectWeekBonus: 150,
      freezeEveryDays: 7,
      maxFreezes: 2,
    });
  });

  it('requires authentication', async () => {
    const request = (await import('supertest')).default;
    await request(e2e.http).get(e2e.url('/me/progression')).expect(401);
  });
});
