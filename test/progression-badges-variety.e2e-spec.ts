import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Noche 2026-10-13 · D5: insignias nuevas (primeras veces, cargas, cardio,
 * comunidad, creador) contra Postgres real, con los campos que pintan la carta.
 */
describe('Progression · variedad de insignias (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  let routineId: string;
  let dayId: string;

  type Badge = {
    code: string;
    earned: boolean;
    isNew: boolean;
    rarity: string;
    rarityRank: number;
    category: string;
    illustration: string;
    criterion: string;
    threshold: number;
    secret: boolean;
    pointsReward: number;
    progress: number | null;
    progressLabel: string | null;
  };

  const progression = async (token: string) =>
    (await e2e.as(token).get('/me/progression').expect(200)).body.data as {
      points: number;
      badges: Badge[];
      unlockedNow: Badge[];
    };
  const badge = (list: Badge[], code: string) => list.find((entry) => entry.code === code);

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('badge-ana');
    leo = await e2e.register('badge-leo');
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  it('quien no ha hecho nada ve las insignias nuevas sin conseguir, con rareza, categoría e ilustración', async () => {
    const view = await progression(ana.token);
    const first = badge(view.badges, 'PRIMERA_RUTINA');
    expect(first).toMatchObject({
      earned: false,
      rarity: 'COMUN',
      rarityRank: 1,
      category: 'CREADOR',
      illustration: 'pencil',
      criterion: 'ROUTINES_CREATED',
      threshold: 1,
      secret: false,
      progress: 0,
      progressLabel: '0 / 1',
    });
    expect(badge(view.badges, 'CIEN_DESCARGAS')).toMatchObject({ rarity: 'LEGENDARIA', rarityRank: 4, illustration: 'crown' });
    expect(badge(view.badges, 'CARDIO_42K')).toMatchObject({ category: 'CARDIO', progressLabel: '0 km / 42,2 km' });
    expect(badge(view.badges, 'DIEZ_HORAS')).toMatchObject({ progressLabel: '0 min / 10 h' });
    // Las de siempre también llevan los campos nuevos.
    expect(badge(view.badges, 'PRIMERA_SESION')).toMatchObject({ illustration: 'first-step', rarityRank: 1 });
    for (const entry of view.badges) {
      expect(entry.illustration).toMatch(/^[a-z]+(-[a-z]+)*$/u);
      expect([1, 2, 3, 4]).toContain(entry.rarityRank);
    }
  });

  it('crear y publicar una rutina da insignias de creador sin haber entrenado', async () => {
    const api = e2e.as(ana.token);
    const stamp = Date.now();
    const bench = await createPersonalExercise(api, `Press insignia ${stamp}`);
    const row = await createPersonalExercise(api, `Remo insignia ${stamp}`);
    const plank = await createPersonalExercise(api, `Plancha insignia ${stamp}`);
    const routine = await api
      .post('/routines')
      .send({
        nombre: `Insignias ${stamp}`,
        dias: [
          {
            diaSemana: 1,
            ejercicios: [
              { ejercicioId: bench, seriesObjetivo: 2, repsMin: 5, repsMax: 5, grupo: 1, descansoEntreSeg: 0 },
              { ejercicioId: row, seriesObjetivo: 2, repsMin: 5, repsMax: 5, grupo: 1, descansoEntreSeg: 0 },
              { ejercicioId: plank, seriesObjetivo: 2, duracionSeg: 45 },
            ],
          },
        ],
      })
      .expect(201);
    routineId = routine.body.data.id as string;
    dayId = routine.body.data.dias[0].id as string;

    const created = await progression(ana.token);
    expect(created.unlockedNow.map((entry) => entry.code)).toEqual(['PRIMERA_RUTINA']);
    expect(badge(created.badges, 'PRIMERA_RUTINA')).toMatchObject({ earned: true, isNew: true, progress: 1 });

    await api.post(`/routines/${routineId}/publish`).expect(201);
    const published = await progression(ana.token);
    expect(published.unlockedNow.map((entry) => entry.code)).toEqual(['PRIMERA_PUBLICA']);
    expect(published.points).toBe(created.points + (badge(published.badges, 'PRIMERA_PUBLICA')?.pointsReward ?? 0));
  });

  it('comentar y valorar dan insignias sociales a quien participa', async () => {
    const api = e2e.as(leo.token);
    await api.put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 5 }).expect(200);
    await api.post(`/comments/ROUTINE/${routineId}`).send({ texto: 'Me sirvió mucho' }).expect(201);
    const view = await progression(leo.token);
    expect(view.unlockedNow.map((entry) => entry.code).sort()).toEqual(['PRIMERA_VALORACION', 'PRIMER_COMENTARIO']);
    expect(badge(view.badges, 'PRIMER_COMENTARIO')).toMatchObject({ category: 'SOCIAL', illustration: 'chat-bubble' });
    expect(badge(view.badges, 'DIEZ_COMENTARIOS')).toMatchObject({ earned: false, progress: 0.1, progressLabel: '1 / 10' });
  });

  it('una sesión con superserie, plancha, carga alta y cardio desbloquea sus cartas al terminar', async () => {
    const api = e2e.as(ana.token);
    const started = await api.post(`/routines/${routineId}/start`).send({ routineDayId: dayId }).expect(201);
    const sessionId = started.body.data.id as string;
    const [benchSe, rowSe, plankSe] = started.body.data.ejercicios.map((e: { id: string }) => e.id);
    const strength = (numeroSerie: number, pesoKg: number) => ({ numeroSerie, repeticiones: 5, pesoKg, rir: 2, descansoSegAnterior: 0 });
    await api.post(`/workouts/session-exercises/${benchSe}/sets`).send(strength(1, 100)).expect(201);
    await api.post(`/workouts/session-exercises/${rowSe}/sets`).send(strength(1, 60)).expect(201);
    await api.post(`/workouts/session-exercises/${plankSe}/sets`).send({ numeroSerie: 1, duracionSeg: 45, descansoSegAnterior: 0 }).expect(201);
    await api.post(`/workouts/session-exercises/${plankSe}/sets`).send({ numeroSerie: 2, duracionSeg: 45, descansoSegAnterior: 0 }).expect(201);
    const cardio = await createPersonalExercise(api, `Cinta insignia ${Date.now()}`);
    const added = await api.post(`/workouts/${sessionId}/exercises`).send({ ejercicioId: cardio, orden: 4 }).expect(201);
    await api
      .post(`/workouts/session-exercises/${added.body.data.id}/sets`)
      .send({ tipoSerie: 'CARDIO', numeroSerie: 1, duracionSeg: 900, distanciaM: 2500 })
      .expect(201);

    const finished = await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200);
    const unlocked = (finished.body.data.progression.unlockedNow as Badge[]).map((entry) => entry.code);
    expect(unlocked).toEqual(
      expect.arrayContaining(['PRIMERA_SESION', 'PRIMERA_SUPERSERIE', 'PRIMERA_PLANCHA', 'CLUB_60', 'CLUB_100', 'PRIMER_CARDIO']),
    );
    expect(unlocked).not.toContain('CLUB_140');
    expect(unlocked).not.toContain('CARDIO_10K');
    const card = (finished.body.data.progression.unlockedNow as Badge[]).find((entry) => entry.code === 'CLUB_100');
    expect(card).toMatchObject({ rarity: 'RARA', rarityRank: 2, illustration: 'barbell-heavy', category: 'FUERZA' });
    expect(finished.body.data.progression.breakdown.badges).toBeGreaterThan(0);

    const view = await progression(ana.token);
    expect(badge(view.badges, 'CARDIO_10K')).toMatchObject({ earned: false, progress: 0.25, progressLabel: '2,5 km / 10 km' });
    expect(badge(view.badges, 'CLUB_140')).toMatchObject({ progressLabel: '100 kg / 140 kg' });
    expect(badge(view.badges, 'PLANCHA_10_MIN')).toMatchObject({ progress: 0.15 });
  });

  it('archivar la rutina no quita la insignia ni baja los puntos', async () => {
    const before = await progression(ana.token);
    await e2e.as(ana.token).del(`/routines/${routineId}`).expect(200);
    const after = await progression(ana.token);
    expect(badge(after.badges, 'PRIMERA_RUTINA')).toMatchObject({ earned: true });
    expect(badge(after.badges, 'PRIMERA_PUBLICA')).toMatchObject({ earned: true });
    expect(after.points).toBe(before.points);
    expect(after.unlockedNow).toEqual([]);
  });
});
