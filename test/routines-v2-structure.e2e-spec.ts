import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { FINGERPRINT_SQL_V2 } from '../src/database/migrations/202610100001-routine-groups-copies-session-targets';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Rutinas v2 · estructura (RF-03..08): días, huella, calendario, ajustes de
 * semana y compatibilidad con las apps instaladas (POST plano + ejercicio suelto).
 */
describe('Routines v2 · structure (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let stranger: { token: string; id: string };
  let squat: string;
  let bench: string;
  let row: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('rv2-owner');
    stranger = await e2e.register('rv2-stranger');
    const api = e2e.as(owner.token);
    squat = await createPersonalExercise(api, `Sentadilla v2 ${Date.now()}`);
    bench = await createPersonalExercise(api, `Press v2 ${Date.now()}`);
    row = await createPersonalExercise(api, `Remo v2 ${Date.now()}`);
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    nombre: 'Empuje y pierna',
    objetivo: 'HIPERTROFIA',
    duracionSemanas: 8,
    progresion: { activa: true, descargaCada: 4 },
    dias: [
      { diaSemana: 1, nombre: 'Pierna', ejercicios: [{ ejercicioId: squat, seriesObjetivo: 4, repsMin: 6, repsMax: 8 }] },
      {
        diaSemana: 3,
        nombre: 'Empuje',
        ejercicios: [
          { ejercicioId: bench, seriesObjetivo: 3, repsMin: 8, repsMax: 10 },
          { ejercicioId: row, seriesObjetivo: 3 },
        ],
      },
    ],
    ...extra,
  });

  it('crea una rutina con días y la devuelve agrupada y aplanada', async () => {
    const res = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const r = res.body.data;
    expect(r.visibilidad).toBe('PRIVATE');
    expect(r.duracionSemanas).toBe(8);
    expect(r.dias).toHaveLength(2);
    expect(r.dias[0]).toMatchObject({ diaSemana: 1, nombre: 'Pierna' });
    expect(r.dias[1].ejercicios).toHaveLength(2);
    expect(r.ejercicios.map((e: { orden: number }) => e.orden)).toEqual([1, 2, 3]);
    expect(r.huellaCorta).toMatch(/^[0-9a-f]{8}$/);
    expect(r.esMia).toBe(true);
    expect(r.puedoEditar).toBe(true);
    expect(r.version).toBe(1);
  });

  it('rechaza un día sin ejercicios con ROUTINE_HAS_NO_DAYS', async () => {
    const res = await e2e
      .as(owner.token)
      .post('/routines')
      .send(body({ dias: [{ diaSemana: 1, ejercicios: [] }] }))
      .expect(400);
    expect(res.body.code).toBe('ROUTINE_HAS_NO_DAYS');
  });

  it('rechaza dos días con el mismo día de la semana', async () => {
    const day = { diaSemana: 2, ejercicios: [{ ejercicioId: squat }] };
    await e2e.as(owner.token).post('/routines').send(body({ dias: [day, day] })).expect(400);
  });

  it('una privada ajena responde 404 (no confirma que exista)', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    await e2e.as(stranger.token).get(`/routines/${created.body.data.id}`).expect(404);
    await e2e.as(stranger.token).get(`/routines/${created.body.data.id}/calendar`).expect(404);
    await e2e.as(stranger.token).put(`/routines/${created.body.data.id}/structure`).send({ dias: [] }).expect(400);
  });

  it('PUT structure reemplaza días y ejercicios y cambia la huella', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const id = created.body.data.id as string;
    const before = created.body.data.huellaCorta as string;
    const res = await e2e
      .as(owner.token)
      .put(`/routines/${id}/structure`)
      .send({ dias: [{ diaSemana: 5, nombre: 'Full', ejercicios: [{ ejercicioId: row, seriesObjetivo: 5 }] }] })
      .expect(200);
    expect(res.body.data.dias).toHaveLength(1);
    expect(res.body.data.ejercicios).toHaveLength(1);
    expect(res.body.data.huellaCorta).not.toBe(before);
  });

  it('un extraño no puede reemplazar la estructura', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    await e2e
      .as(stranger.token)
      .put(`/routines/${created.body.data.id}/structure`)
      .send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: squat }] }] })
      .expect(404);
  });

  it('el calendario aplica la descarga activa cada 4 semanas', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const res = await e2e.as(owner.token).get(`/routines/${created.body.data.id}/calendar`).expect(200);
    const weeks = res.body.data.semanas;
    expect(weeks).toHaveLength(8);
    expect(weeks.filter((w: { esDescarga: boolean }) => w.esDescarga).map((w: { numero: number }) => w.numero)).toEqual([4, 8]);
    expect(weeks[3].dias[0].ejercicios[0].series).toBe(2); // 4 series × 0,5
    expect(weeks[0].dias[0].ejercicios[0].series).toBe(4);
  });

  it('un ajuste manual de semana manda sobre la regla y se puede quitar', async () => {
    const created = await e2e.as(owner.token).post('/routines').send(body()).expect(201);
    const id = created.body.data.id as string;
    await e2e.as(owner.token).put(`/routines/${id}/weeks/4`).send({ esDescarga: false, factorVolumen: 1, factorCarga: 1 }).expect(200);
    let cal = await e2e.as(owner.token).get(`/routines/${id}/calendar`).expect(200);
    expect(cal.body.data.semanas[3].esDescarga).toBe(false);
    await e2e.as(owner.token).del(`/routines/${id}/weeks/4`).expect(200);
    cal = await e2e.as(owner.token).get(`/routines/${id}/calendar`).expect(200);
    expect(cal.body.data.semanas[3].esDescarga).toBe(true);
    await e2e.as(owner.token).put(`/routines/${id}/weeks/9`).send({ esDescarga: true }).expect(400);
  });

  it('compatibilidad: POST plano sin días + ejercicio suelto cae en el primer día', async () => {
    const created = await e2e.as(owner.token).post('/routines').send({ nombre: 'Plana vieja' }).expect(201);
    expect(created.body.data.dias).toHaveLength(1);
    expect(created.body.data.dias[0].diaSemana).toBeNull();
    const id = created.body.data.id as string;
    const res = await e2e
      .as(owner.token)
      .post(`/routines/${id}/exercises`)
      .send({ ejercicioId: squat, orden: 1, seriesObjetivo: 3 })
      .expect(201);
    expect(res.body.data.dias[0].ejercicios).toHaveLength(1);
    expect(res.body.data.ejercicios).toHaveLength(1);
  });

  it('compatibilidad: visibilidad TEMPLATE de una app vieja se guarda PRIVATE y PUBLIC se rechaza', async () => {
    const legacy = await e2e.as(owner.token).post('/routines').send({ nombre: 'Vieja plantilla', visibilidad: 'TEMPLATE' }).expect(201);
    expect(legacy.body.data.visibilidad).toBe('PRIVATE');
    await e2e.as(owner.token).post('/routines').send({ nombre: 'Directa pública', visibilidad: 'PUBLIC' }).expect(400);
    await e2e.as(owner.token).patch(`/routines/${legacy.body.data.id}`).send({ visibilidad: 'PUBLIC' }).expect(400);
  });

  it('borrar archiva: deja de salir en «mine» pero no se destruye', async () => {
    const created = await e2e.as(owner.token).post('/routines').send({ nombre: 'Para archivar' }).expect(201);
    const id = created.body.data.id as string;
    await e2e.as(owner.token).del(`/routines/${id}`).expect(200);
    const list = await e2e.as(owner.token).get('/routines?scope=mine&pageSize=100').expect(200);
    expect(list.body.data.items.some((r: { id: string }) => r.id === id)).toBe(false);
    const still = await e2e.as(owner.token).get(`/routines/${id}`).expect(200);
    expect(still.body.data.estado).toBe('ARCHIVED');
  });

  describe('C3 · superseries, circuitos, series por tiempo y objetivos en la sesión', () => {
    let plank: string;
    beforeAll(async () => {
      plank = await createPersonalExercise(e2e.as(owner.token), `Plancha v2 ${Date.now()}`);
    });

    const todayIso = (() => {
      const d = new Date().getDay();
      return d === 0 ? 7 : d;
    })();

    /** Día de hoy: superserie A (press+remo), circuito B (sentadilla, plancha por tiempo, press otra vez) y un suelto. */
    const grouped = () => ({
      nombre: `Bloques ${Date.now()}`,
      duracionSemanas: 4,
      progresion: { activa: true, descargaCada: 4 },
      dias: [
        {
          diaSemana: todayIso,
          nombre: 'Torso',
          ejercicios: [
            { ejercicioId: bench, seriesObjetivo: 3, repsMin: 8, repsMax: 12, pesoObjetivoKg: 60, rirObjetivo: 2, descansoSeg: 15, grupo: 5, descansoEntreSeg: 0, nota: 'Codos a 45°' },
            { ejercicioId: row, seriesObjetivo: 3, repsMin: 8, repsMax: 12, descansoSeg: 120, grupo: 5, descansoEntreSeg: 0 },
            { ejercicioId: squat, seriesObjetivo: 4, repsMin: 10, repsMax: 10, grupo: 9, descansoEntreSeg: 15 },
            { ejercicioId: plank, seriesObjetivo: 3, repsMin: 10, duracionSeg: 45, grupo: 9, descansoEntreSeg: 15 },
            { ejercicioId: bench, seriesObjetivo: 2, repsMin: 15, repsMax: 20, grupo: 9, descansoEntreSeg: 15, descansoSeg: 90 },
            { ejercicioId: row, seriesObjetivo: 2, repsMin: 12, repsMax: 15, descansoEntreSeg: 30 },
          ],
        },
      ],
    });

    let routineId = '';

    it('crea superserie y circuito: grupos renumerados, tipo derivado, duración sin reps y el mismo ejercicio dos veces', async () => {
      const res = await e2e.as(owner.token).post('/routines').send(grouped()).expect(201);
      routineId = res.body.data.id;
      const items = res.body.data.dias[0].ejercicios;
      expect(items).toHaveLength(6);
      expect(items.map((e: { grupo: number | null }) => e.grupo)).toEqual([1, 1, 2, 2, 2, null]);
      expect(items.map((e: { grupoTipo: string | null }) => e.grupoTipo)).toEqual([
        'SUPERSERIE', 'SUPERSERIE', 'CIRCUITO', 'CIRCUITO', 'CIRCUITO', null,
      ]);
      expect(items[0]).toMatchObject({ seriesObjetivo: 3, repsMin: 8, repsMax: 12, pesoObjetivoKg: 60, rirObjetivo: 2, descansoSeg: 15, descansoEntreSeg: 0, duracionSeg: null, nota: 'Codos a 45°' });
      expect(items[3]).toMatchObject({ duracionSeg: 45, repsMin: null, repsMax: null });
      // Fuera de un bloque no hay descanso entre ejercicios.
      expect(items[5]).toMatchObject({ grupo: null, grupoTipo: null, descansoEntreSeg: null });
    });

    it('la huella SQL de la migración coincide con la de TS (también con bloques y duración)', async () => {
      const rows = await e2e.app.get(Sequelize).query<{ huella: string; guardada: string }>(
        `SELECT f.huella, r.huella AS guardada FROM (${FINGERPRINT_SQL_V2}) f JOIN training.routines r ON r.id = f.routine_id WHERE r.id = :id`,
        { type: QueryTypes.SELECT, replacements: { id: routineId } },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].huella).toBe(rows[0].guardada);
      // Y las rutinas sin bloques conservan la huella antigua: la SQL nueva coincide con TODAS las guardadas.
      const drift = await e2e.app.get(Sequelize).query<{ n: string }>(
        `SELECT count(*) AS n FROM (${FINGERPRINT_SQL_V2}) f JOIN training.routines r ON r.id = f.routine_id
          WHERE r.huella IS NOT NULL AND r.huella <> f.huella`,
        { type: QueryTypes.SELECT },
      );
      expect(Number(drift[0].n)).toBe(0);
    });

    it('un bloque de 1 ejercicio o no contiguo es 400 ROUTINE_GROUP_INVALID', async () => {
      const single = await e2e
        .as(owner.token)
        .put(`/routines/${routineId}/structure`)
        .send({ dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: bench, grupo: 1 }, { ejercicioId: row }] }] })
        .expect(400);
      expect(single.body.code).toBe('ROUTINE_GROUP_INVALID');
      const split = await e2e
        .as(owner.token)
        .post('/routines')
        .send({ nombre: 'Partida', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: bench, grupo: 1 }, { ejercicioId: row }, { ejercicioId: squat, grupo: 1 }] }] })
        .expect(400);
      expect(split.body.code).toBe('ROUTINE_GROUP_INVALID');
      // Nada se guardó: la rutina conserva sus 6 ejercicios.
      expect((await e2e.as(owner.token).get(`/routines/${routineId}`).expect(200)).body.data.ejercicios).toHaveLength(6);
    });

    it('topes: más de 10 series o de 50 reps es 400 en rutinas nuevas', async () => {
      await e2e.as(owner.token).post('/routines').send({ nombre: 'Series', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: bench, seriesObjetivo: 11 }] }] }).expect(400);
      await e2e.as(owner.token).post('/routines').send({ nombre: 'Reps', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: bench, repsMin: 51 }] }] }).expect(400);
      await e2e.as(owner.token).post('/routines').send({ nombre: 'Tope', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: bench, seriesObjetivo: 10, repsMin: 50, repsMax: 50 }] }] }).expect(201);
    });

    it('el calendario lleva descanso, RIR, nota, bloque y duración en cada semana', async () => {
      const res = await e2e.as(owner.token).get(`/routines/${routineId}/calendar`).expect(200);
      const [first] = res.body.data.semanas[0].dias[0].ejercicios;
      expect(first).toMatchObject({ descansoSeg: 15, rirObjetivo: 2, nota: 'Codos a 45°', grupo: 1, grupoTipo: 'SUPERSERIE', descansoEntreSeg: 0, duracionSeg: null });
      const deload = res.body.data.semanas[3].dias[0].ejercicios[3];
      expect(deload).toMatchObject({ grupo: 2, grupoTipo: 'CIRCUITO', duracionSeg: 45, repsMin: null });
    });

    it('el payload trae la miniatura principal del ejercicio (sin N+1)', async () => {
      await e2e.sql(
        `INSERT INTO training.exercise_media (id, ejercicio_id, media_type, provider, url, thumbnail_url, alt_text, is_primary, sort_order)
         VALUES (uuid_generate_v4(), :id, 'VIDEO', 'EXTERNAL_URL', 'https://cdn.example.test/press.mp4', 'https://cdn.example.test/press-poster.webp', 'Press', true, 0),
                (uuid_generate_v4(), :id, 'IMAGE', 'EXTERNAL_URL', 'https://cdn.example.test/press-2.webp', NULL, 'Press 2', false, 1)`,
        { id: bench },
      );
      const res = await e2e.as(owner.token).get(`/routines/${routineId}`).expect(200);
      const media = res.body.data.dias[0].ejercicios[0].ejercicio.media;
      expect(media).toHaveLength(1);
      expect(media[0]).toMatchObject({ isPrimary: true, mediaType: 'VIDEO', thumbnailUrl: 'https://cdn.example.test/press-poster.webp' });
      expect(res.body.data.dias[0].ejercicios[1].ejercicio.media).toEqual([]);
      expect(res.body.data.dias[0].ejercicios[0].ejercicio).toHaveProperty('nombreEs', null);
      const list = await e2e.as(owner.token).get('/routines?scope=mine&pageSize=100').expect(200);
      const mine = list.body.data.items.find((r: { id: string }) => r.id === routineId);
      expect(mine.ejercicios[0].ejercicio.media).toHaveLength(1);
    });

    it('empezar la sesión copia objetivos y bloques; el ejercicio repetido entra dos veces', async () => {
      const day = (await e2e.as(owner.token).get(`/routines/${routineId}`).expect(200)).body.data.dias[0].id as string;
      const started = await e2e.as(owner.token).post(`/routines/${routineId}/start`).send({ routineDayId: day }).expect(201);
      const items = started.body.data.ejercicios;
      expect(items).toHaveLength(6);
      expect(items[0]).toMatchObject({ seriesObjetivo: 3, repsMin: 8, repsMax: 12, pesoObjetivoKg: 60, rirObjetivo: 2, descansoSeg: 15, descansoEntreSeg: 0, grupo: 1, grupoTipo: 'SUPERSERIE', duracionSeg: null, nota: 'Codos a 45°' });
      expect(items[3]).toMatchObject({ duracionSeg: 45, repsMin: null, grupo: 2, grupoTipo: 'CIRCUITO' });
      expect(items.filter((e: { ejercicio: { id: string } }) => e.ejercicio.id === bench)).toHaveLength(2);
      const detail = await e2e.as(owner.token).get(`/workouts/${started.body.data.id}`).expect(200);
      expect(detail.body.data.ejercicios[1]).toMatchObject({ descansoSeg: 120, grupo: 1 });
    });
  });
});
