import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';
import {
  frozenFactsBatch,
  grandfatherExistingProfileItems,
} from '../src/database/migrations/profile-completion-backfill.snapshot';
import { loadProfileFacts } from '../src/modules/progression/profile-completion.repository';

type CompletionItem = { code: string; done: boolean; awarded: boolean; points: number };
type Completion = {
  items: CompletionItem[];
  completed: number;
  percent: number;
  pointsEarned: number;
  pointsAvailable: number;
  pointsTotal: number;
  awardedNow: string[];
};

/** Puntos por completar el perfil: reales, una vez por dato, y leídos del API. */
describe('Profile completion points (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  const password = 'e2e-strong-password';
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  async function registerAccount(label: string): Promise<string> {
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email: `completion-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
        password,
        nombreCompleto: `Perfil ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  async function completion(token: string): Promise<Completion> {
    const response = await request(httpServer)
      .get(url('/me/progression/profile-completion'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body.data as Completion;
  }

  async function accountId(token: string): Promise<string> {
    const me = await request(httpServer).get(url('/auth/me')).set('Authorization', `Bearer ${token}`).expect(200);
    return (me.body.data?.id ?? me.body.data?.usuario?.id) as string;
  }

  async function ledgerOf(userId: string): Promise<{ item_code: string; points: number; tenant_id: string | null }[]> {
    const [rows] = await application.get(Sequelize).query(
      'SELECT item_code, points, tenant_id FROM progression.profile_completion_awards WHERE user_id = :userId ORDER BY item_code',
      { replacements: { userId } },
    );
    return rows as { item_code: string; points: number; tenant_id: string | null }[];
  }

  const item = (view: Completion, code: string) => view.items.find((entry) => entry.code === code);

  it('requires a session', async () => {
    await request(httpServer).get(url('/me/progression/profile-completion')).expect(401);
  });

  it('awards each datum once, counts it in the senda and never takes it back', async () => {
    const token = await registerAccount('flow');
    const auth = { Authorization: `Bearer ${token}` };

    const empty = await completion(token);
    expect(empty.pointsTotal).toBe(250);
    expect(item(empty, 'BIO')).toMatchObject({ done: false, awarded: false, points: 40 });
    expect(item(empty, 'FOTO')).toMatchObject({ done: false, awarded: false });
    const startPoints = empty.pointsEarned;

    await request(httpServer).patch(url('/profile')).set(auth)
      .send({ pesoKg: 70, estaturaCm: 175, objetivo: 'FUERZA' }).expect(200);
    const bio = await request(httpServer).patch(url('/users/me')).set(auth)
      .send({ bio: '  Pierna los lunes.\nCafé después.  ' }).expect(200);
    expect(bio.body.data.bio).toBe('Pierna los lunes. Café después.');
    const photo = await request(httpServer).post(url('/me/photos')).set(auth)
      .attach('file', tinyPng, { filename: 'a.png', contentType: 'image/png' }).expect(201);

    const after = await completion(token);
    expect(after.awardedNow).toEqual(expect.arrayContaining(['DATOS', 'BIO', 'FOTO']));
    expect(after.pointsEarned).toBe(startPoints + 50 + 40 + 50);
    expect(item(after, 'FOTO')).toMatchObject({ done: true, awarded: true });

    // Idempotent: reading again pays nothing new.
    const again = await completion(token);
    expect(again.awardedNow).toEqual([]);
    expect(again.pointsEarned).toBe(after.pointsEarned);

    // The senda carries the same figure in its own breakdown and total.
    // A fresh account has trained nothing: its whole balance is the profile.
    // (GET /me/progression exposes no breakdown; the per-key check is in the
    // session-close test below, on the finish response.)
    const senda = await request(httpServer).get(url('/me/progression')).set(auth).expect(200);
    expect(senda.body.data.points).toBe(after.pointsEarned);
    expect(senda.body.data.arenaPoints).toBe(after.pointsEarned);
    const rules = await request(httpServer).get(url('/me/progression/rules')).expect(200);
    expect(rules.body.data.profileItems).toEqual(expect.arrayContaining([{ code: 'FOTO', points: 50 }]));

    // Removing the photo keeps the points; uploading again does not pay twice.
    await request(httpServer).delete(url(`/me/photos/${photo.body.data.id as string}`)).set(auth).expect(200);
    const removed = await completion(token);
    expect(item(removed, 'FOTO')).toMatchObject({ done: false, awarded: true });
    expect(removed.pointsEarned).toBe(after.pointsEarned);
    await request(httpServer).post(url('/me/photos')).set(auth)
      .attach('file', tinyPng, { filename: 'b.png', contentType: 'image/png' }).expect(201);
    const back = await completion(token);
    expect(back.awardedNow).toEqual([]);
    expect(back.pointsEarned).toBe(after.pointsEarned);
  });

  it('pays concurrent reads exactly once', async () => {
    const token = await registerAccount('race');
    await request(httpServer).patch(url('/users/me')).set('Authorization', `Bearer ${token}`)
      .send({ bio: 'Corro los sábados.' }).expect(200);
    const views = await Promise.all([completion(token), completion(token), completion(token)]);
    const payers = views.filter((view) => view.awardedNow.includes('BIO'));
    expect(payers).toHaveLength(1);
    const final = await completion(token);
    expect(new Set(views.map((view) => view.pointsEarned)).size).toBe(1);
    expect(final.pointsEarned).toBe(views[0].pointsEarned);
  });

  it('edits level and interests without reopening onboarding, and pays for them', async () => {
    const token = await registerAccount('training');
    const auth = { Authorization: `Bearer ${token}` };
    const before = await request(httpServer).get(url('/me/onboarding')).set(auth).expect(200);

    const updated = await request(httpServer).patch(url('/me/onboarding/preferences')).set(auth)
      .send({ experienceLevel: 'INTERMEDIATE', trainingPreferences: ['Fuerza', 'Cardio'] }).expect(200);
    expect(updated.body.data.status).toBe(before.body.data.status);
    expect(updated.body.data.trainingPreferences).toEqual(['Fuerza', 'Cardio']);

    const view = await completion(token);
    expect(view.awardedNow).toEqual(expect.arrayContaining(['NIVEL', 'INTERESES']));

    await request(httpServer).patch(url('/me/onboarding/preferences')).set(auth)
      .send({ consentHealth: false }).expect(400);
  });

  it('saves every training goal the API offers, sport performance included', async () => {
    const token = await registerAccount('goals');
    for (const objetivo of ['HIPERTROFIA', 'FUERZA', 'RESISTENCIA', 'PERDIDA_GRASA', 'SALUD_GENERAL', 'RENDIMIENTO_DEPORTIVO', 'REHABILITACION']) {
      const saved = await request(httpServer).patch(url('/profile')).set('Authorization', `Bearer ${token}`)
        .send({ pesoKg: 70, estaturaCm: 175, objetivo });
      expect({ objetivo, status: saved.status }).toEqual({ objetivo, status: 200 });
    }
  });

  it('rejects an oversized bio and keeps each account\'s ledger to itself', async () => {
    const owner = await registerAccount('owner');
    const other = await registerAccount('other');
    await request(httpServer).patch(url('/users/me')).set('Authorization', `Bearer ${owner}`)
      .send({ bio: 'x'.repeat(161) }).expect(400);
    await request(httpServer).patch(url('/users/me')).set('Authorization', `Bearer ${owner}`)
      .send({ bio: 'Entreno a las 7.' }).expect(200);

    const ownerView = await completion(owner);
    const otherView = await completion(other);
    expect(item(ownerView, 'BIO')).toMatchObject({ done: true, awarded: true });
    expect(item(otherView, 'BIO')).toMatchObject({ done: false, awarded: false });
  });

  it('pays nothing for profile data a member already had at deploy time, and pays what is completed after', async () => {
    const token = await registerAccount('legacy');
    const userId = await accountId(token);
    const auth = { Authorization: `Bearer ${token}` };
    // Data saved before the migration (nothing has read the completion yet).
    await request(httpServer).patch(url('/profile')).set(auth)
      .send({ pesoKg: 70, estaturaCm: 175, objetivo: 'FUERZA' }).expect(200);
    await request(httpServer).patch(url('/users/me')).set(auth).send({ genero: 'FEMALE' }).expect(200);
    await request(httpServer).patch(url('/me/onboarding/preferences')).set(auth)
      .send({ experienceLevel: 'BEGINNER', trainingPreferences: ['Fuerza'] }).expect(200);
    await request(httpServer).post(url('/me/photos')).set(auth)
      .attach('file', tinyPng, { filename: 'legacy.png', contentType: 'image/png' }).expect(201);
    expect(await ledgerOf(userId)).toEqual([]);

    // The migration's backfill, scoped to this account so the shared database is untouched.
    await expect(grandfatherExistingProfileItems(application.get(Sequelize), undefined, [userId])).resolves.toBe(5);
    const ledger = await ledgerOf(userId);
    expect(ledger.map((row) => row.item_code)).toEqual(['DATOS', 'FOTO', 'GENERO', 'INTERESES', 'NIVEL']);
    expect(ledger.every((row) => row.points === 0 && row.tenant_id !== null)).toBe(true);
    // Idempotent: running it again writes nothing.
    await expect(grandfatherExistingProfileItems(application.get(Sequelize), undefined, [userId])).resolves.toBe(0);

    const legacy = await completion(token);
    expect(legacy.awardedNow).toEqual([]);
    expect(legacy.pointsEarned).toBe(0);
    expect(item(legacy, 'FOTO')).toMatchObject({ done: true, awarded: true, points: 0 });
    expect(legacy.pointsAvailable).toBe(40 + 30 + 20);
    const sendaBefore = await request(httpServer).get(url('/me/progression')).set(auth).expect(200);
    expect(sendaBefore.body.data.points).toBe(0);

    // A missing item completed after the deploy pays as usual.
    await request(httpServer).patch(url('/users/me')).set(auth).send({ bio: 'Sentadilla los martes.' }).expect(200);
    const after = await completion(token);
    expect(after.awardedNow).toEqual(['BIO']);
    expect(after.pointsEarned).toBe(40);
    const sendaAfter = await request(httpServer).get(url('/me/progression')).set(auth).expect(200);
    expect(sendaAfter.body.data.points).toBe(40);
  });

  it('does not pay for an invisible or contentless bio', async () => {
    const token = await registerAccount('blank-bio');
    const auth = { Authorization: `Bearer ${token}` };
    const blank = await request(httpServer).patch(url('/users/me')).set(auth)
      .send({ bio: '\u200B\u3164\u115F\u1160\uFFA0' }).expect(200);
    expect(blank.body.data.bio).toBeNull();
    const rtl = await request(httpServer).patch(url('/users/me')).set(auth).send({ bio: '\u202Eab' }).expect(200);
    expect(rtl.body.data.bio).toBe('ab');
    expect(item(await completion(token), 'BIO')).toMatchObject({ done: false, awarded: false });
    await request(httpServer).patch(url('/users/me')).set(auth).send({ bio: '💪💪💪' }).expect(200);
    expect(item(await completion(token), 'BIO')).toMatchObject({ done: false, awarded: false });
  });

  it('saves the recomputed senda when the completion read pays: the leaderboard sees it at once', async () => {
    const token = await registerAccount('board');
    const userId = await accountId(token);
    await request(httpServer).patch(url('/users/me')).set('Authorization', `Bearer ${token}`)
      .send({ bio: 'Remo y dominadas.' }).expect(200);
    const view = await completion(token);
    expect(view.awardedNow).toEqual(['BIO']);
    const [rows] = await application.get(Sequelize).query(
      'SELECT points FROM progression.user_progress WHERE usuario_id = :userId',
      { replacements: { userId } },
    );
    expect((rows as { points: number }[])[0]?.points).toBe(view.pointsEarned);
  });

  it('does not credit a finished session with profile points paid at its close', async () => {
    const token = await registerAccount('session');
    const auth = { Authorization: `Bearer ${token}` };
    // Pending profile item: the session close's sync() pays it.
    await request(httpServer).patch(url('/users/me')).set(auth).send({ bio: 'Pecho y espalda.' }).expect(200);
    const list = await request(httpServer).get(url(`/exercises?pageSize=1&page=${1 + Math.floor(Math.random() * 300)}`)).set(auth).expect(200);
    const started = await request(httpServer).post(url('/workouts')).set(auth).send({ observacion: 'libre' }).expect(201);
    const sessionId = started.body.data.id as string;
    const exercise = await request(httpServer).post(url(`/workouts/${sessionId}/exercises`)).set(auth)
      .send({ ejercicioId: list.body.data.items[0].id as string, orden: 1, esEnfasis: false }).expect(201);
    await request(httpServer).post(url(`/workouts/session-exercises/${exercise.body.data.id as string}/sets`)).set(auth)
      .send({ numeroSerie: 1, repeticiones: 8, pesoKg: 40, rir: 2, descansoSegAnterior: 60 }).expect(201);
    await application.get(Sequelize).query(
      `UPDATE public.sesiones_entrenamiento SET fecha_inicio = now() - interval '30 minutes' WHERE id = :sessionId`,
      { replacements: { sessionId } },
    );
    const finished = await request(httpServer).patch(url(`/workouts/${sessionId}/finish`)).set(auth).send({}).expect(200);
    const reward = finished.body.data.progression as { pointsEarned: number; pointsBefore: number; pointsAfter: number; breakdown: Record<string, number> };

    expect(reward).not.toBeNull();
    expect(reward.breakdown.profile).toBe(0);
    // The bio was paid during the close, but before the session's own points.
    expect(reward.pointsBefore).toBe(40);
    const { penalties, strikePurchases, ...earned } = reward.breakdown;
    expect(Object.values(earned).reduce((a, b) => a + b, 0) - penalties - strikePurchases).toBe(reward.pointsEarned);
    const view = await completion(token);
    expect(item(view, 'BIO')).toMatchObject({ awarded: true });
    expect(view.awardedNow).toEqual([]);
  });

  it('frozen backfill facts query matches the live repository on real rows', async () => {
    const sequelize = application.get(Sequelize);
    const tokens = await Promise.all(['parity-a', 'parity-b', 'parity-c', 'parity-d'].map((label) => registerAccount(label)));
    const ids = await Promise.all(tokens.map((token) => accountId(token)));
    const [a, , c] = tokens.map((token) => ({ Authorization: `Bearer ${token}` }));
    // a: everything (3 photos, one hidden by moderation, birth date, level, interests, bio, gender).
    await request(httpServer).patch(url('/profile')).set(a)
      .send({ pesoKg: 70, estaturaCm: 175, objetivo: 'FUERZA', fechaNacimiento: '1990-05-01' }).expect(200);
    await request(httpServer).patch(url('/users/me')).set(a).send({ genero: 'UNSPECIFIED', bio: 'Corro y levanto.' }).expect(200);
    await request(httpServer).patch(url('/me/onboarding/preferences')).set(a)
      .send({ experienceLevel: 'ADVANCED', trainingPreferences: ['Fuerza', 'Cardio'] }).expect(200);
    for (const name of ['p1.png', 'p2.png', 'p3.png', 'p4.png']) {
      await request(httpServer).post(url('/me/photos')).set(a)
        .attach('file', tinyPng, { filename: name, contentType: 'image/png' }).expect(201);
    }
    await sequelize.query(
      'UPDATE profile.photos SET hidden_at = now() WHERE id = (SELECT id FROM profile.photos WHERE user_id = :userId LIMIT 1)',
      { replacements: { userId: ids[0] } },
    );
    // b: bio stored before sanitising existed (invisible content written straight to the column).
    await sequelize.query('UPDATE public.usuarios SET bio = :bio WHERE id = :userId', {
      replacements: { bio: '\u3164\u200Bab\u202E', userId: ids[1] },
    });
    // c: only body data, empty interests; d: nothing.
    await request(httpServer).patch(url('/profile')).set(c).send({ pesoKg: 60, estaturaCm: 160, objetivo: 'SALUD_GENERAL' }).expect(200);
    await request(httpServer).patch(url('/me/onboarding/preferences')).set(c).send({ trainingPreferences: [] }).expect(200);

    const live = (await loadProfileFacts(sequelize, ids)).sort((x, y) => x.userId.localeCompare(y.userId));
    const frozen = await frozenFactsBatch(sequelize, '00000000-0000-0000-0000-000000000000', ids);
    expect(frozen).toEqual(live);
    expect(frozen).toHaveLength(4);
    const byId = new Map(frozen.map((row) => [row.userId, row.facts]));
    expect(byId.get(ids[0])).toMatchObject({ photoCount: 3, hasBio: true, hasGender: true, interestCount: 2 });
    expect(byId.get(ids[1])?.hasBio).toBe(false);
  });
});
