import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { WorkoutSessionStatus } from '../src/common/enums/domain.enums';
import { env } from '../src/config/env';
import { WorkoutSessionModel } from '../src/modules/workouts/workout-session.model';

/**
 * `computeStreaks()` ya tiene cobertura unitaria pura (`progression.spec.ts`).
 * Lo que falta, y lo que este archivo cubre, es el camino completo contra
 * Postgres real: la consulta SQL que agrega días de entrenamiento por zona
 * horaria de negocio, su persistencia en `progression.user_progress` y la
 * respuesta de `GET /me/progression`.
 *
 * Cada escenario registra su propia cuenta: compartir una entre pruebas haría
 * que los días sembrados por una se acumularan en la racha de la siguiente.
 */
describe('Progression streaks (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let sessionModel: typeof WorkoutSessionModel;

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
    sessionModel = moduleRef.get(getModelToken(WorkoutSessionModel));
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  function url(path: string): string {
    return `/${env.API_PREFIX}${path}`;
  }

  async function registerUser(label: string): Promise<{ accessToken: string; userId: string }> {
    const email = `e2e-streak-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const response = await request(httpServer)
      .post(url('/auth/register'))
      .send({
        email,
        password: 'e2e-strong-password',
        nombreCompleto: `Racha ${label}`,
        acceptedTerms: true,
      })
      .expect(201);
    return {
      accessToken: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  }

  /** Mismo cálculo que `businessToday()`/`shiftDays()` en el repositorio, para sembrar días que caigan del lado correcto de la zona horaria de negocio. */
  function businessDay(offsetDays: number): string {
    const base = new Intl.DateTimeFormat('en-CA', {
      timeZone: env.BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [year, month, day] = base.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
  }

  /** 1 = lunes ... 7 = domingo, igual que `EXTRACT(ISODOW ...)` en el repositorio. */
  function isoWeekdayOf(dateOnly: string): number {
    const [year, month, day] = dateOnly.split('-').map(Number);
    const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return jsDay === 0 ? 7 : jsDay;
  }

  /** Mediodía en la zona de negocio configurada (sin DST), lejos de cualquier borde de medianoche. */
  async function seedFinishedSession(userId: string, dayOffset: number): Promise<void> {
    const day = businessDay(dayOffset);
    const startedAt = new Date(`${day}T16:00:00.000Z`);
    await sessionModel.create({
      userId,
      startedAt,
      finishedAt: startedAt,
      status: WorkoutSessionStatus.COMPLETED,
    });
  }

  it('computes zero streak with no finished sessions', async () => {
    const { accessToken } = await registerUser('none');

    const response = await request(httpServer)
      .get(url('/me/progression'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.stats.currentStreakDays).toBe(0);
    expect(response.body.data.stats.longestStreakDays).toBe(0);
  });

  it('computes a live streak from three consecutive training days ending today', async () => {
    const { accessToken, userId } = await registerUser('live');
    await seedFinishedSession(userId, -2);
    await seedFinishedSession(userId, -1);
    await seedFinishedSession(userId, 0);

    const response = await request(httpServer)
      .get(url('/me/progression'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.stats.currentStreakDays).toBe(3);
    expect(response.body.data.stats.longestStreakDays).toBe(3);
  });

  it('breaks the current streak after a gap of more than one day, but keeps the longest', async () => {
    const { accessToken, userId } = await registerUser('broken');
    // Un tramo de tres días, seguido de un hueco de varios días hasta hoy: la
    // racha vigente debe caer a cero aunque la más larga recuerde el tramo.
    await seedFinishedSession(userId, -6);
    await seedFinishedSession(userId, -5);
    await seedFinishedSession(userId, -4);

    const response = await request(httpServer)
      .get(url('/me/progression'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.stats.currentStreakDays).toBe(0);
    expect(response.body.data.stats.longestStreakDays).toBe(3);
  });

  it('sorts the leaderboard by streak in non-increasing order when sortBy=streak', async () => {
    const { accessToken, userId } = await registerUser('leaderboard');
    await seedFinishedSession(userId, -1);
    await seedFinishedSession(userId, 0);
    // Fuerza el recálculo de user_progress antes de leer la clasificación: es
    // de lectura perezosa, y sin esto la fila de esta cuenta seguiría en cero.
    await request(httpServer)
      .get(url('/me/progression'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const leaderboardResponse = await request(httpServer)
      .get(url('/me/progression/leaderboard?sortBy=streak&limit=50'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const entries = leaderboardResponse.body.data as Array<{ streakDays: number }>;
    // No se asume que la cuenta recién sembrada quede entre las primeras 50: el
    // gimnasio de pruebas puede tener más cuentas con racha que el límite de la
    // API. Lo que sí debe cumplirse siempre es el orden.
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index].streakDays).toBeLessThanOrEqual(entries[index - 1].streakDays);
    }
  });

  describe('rest days', () => {
    it('starts with no declared rest days', async () => {
      const { accessToken } = await registerUser('rest-default');

      const response = await request(httpServer)
        .get(url('/me/progression/rest-days'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.weekdays).toEqual([]);
    });

    it('persists a declared set of rest weekdays', async () => {
      const { accessToken } = await registerUser('rest-set');

      await request(httpServer)
        .patch(url('/me/progression/rest-days'))
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ weekdays: [6, 7] })
        .expect(200);

      const response = await request(httpServer)
        .get(url('/me/progression/rest-days'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.weekdays).toEqual([6, 7]);
    });

    it('rejects marking all seven days as rest', async () => {
      const { accessToken } = await registerUser('rest-invalid');

      await request(httpServer)
        .patch(url('/me/progression/rest-days'))
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ weekdays: [1, 2, 3, 4, 5, 6, 7] })
        .expect(400);
    });

    it('bridges the streak across a gap that falls entirely on a declared rest day', async () => {
      const { accessToken, userId } = await registerUser('rest-bridge');
      // Entrena hace dos días y hoy, sin nada ayer: sin días de descanso
      // declarados eso es una racha de un solo día.
      await seedFinishedSession(userId, -2);
      await seedFinishedSession(userId, 0);
      const skippedWeekday = isoWeekdayOf(businessDay(-1));

      const before = await request(httpServer)
        .get(url('/me/progression'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(before.body.data.stats.currentStreakDays).toBe(1);

      await request(httpServer)
        .patch(url('/me/progression/rest-days'))
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ weekdays: [skippedWeekday] })
        .expect(200);

      const after = await request(httpServer)
        .get(url('/me/progression'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(after.body.data.stats.currentStreakDays).toBe(2);
      expect(after.body.data.stats.longestStreakDays).toBe(2);
    });
  });

  describe('streak rewards', () => {
    it('grants no reward before the first threshold', async () => {
      const { accessToken, userId } = await registerUser('reward-none');
      await seedFinishedSession(userId, 0);

      await request(httpServer)
        .get(url('/me/progression'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const accesses = await request(httpServer)
        .get(url('/me/accesses'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(accesses.body.data.some((access: { code: string }) => access.code === 'STREAK_REWARD_7')).toBe(
        false,
      );
    });

    it('grants the 7-day reward once the longest streak reaches it, and does not duplicate it on a later read', async () => {
      const { accessToken, userId } = await registerUser('reward-seven');
      for (let offset = -6; offset <= 0; offset += 1) {
        await seedFinishedSession(userId, offset);
      }

      const progression = await request(httpServer)
        .get(url('/me/progression'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(progression.body.data.stats.longestStreakDays).toBe(7);

      // Segunda lectura: no debe intentar otorgar el mismo beneficio otra vez.
      await request(httpServer)
        .get(url('/me/progression'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const accesses = await request(httpServer)
        .get(url('/me/accesses'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const rewards = (accesses.body.data as Array<{ code: string; source: string }>).filter(
        (access) => access.code === 'STREAK_REWARD_7',
      );
      expect(rewards).toHaveLength(1);
      expect(rewards[0].source).toBe('STREAK_REWARD');
    });
  });
});
