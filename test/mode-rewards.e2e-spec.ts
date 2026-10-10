import { ProgramWeekCloseService } from '../src/modules/programs/program-week-close.service';
import { bootE2eApp, E2eApp } from './support/e2e-app';

/** RF-17/RF-18 · cardio, multiplicador semanal, libro de bonos y regresión de volumen. */
describe('Mode rewards and cardio (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let g1 = '';
  let g2 = '';
  const todayIso = (() => {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  })();
  const dayOffset = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('rew-ana');
    const list = await e2e.as(ana.token).get(`/exercises?pageSize=2&page=${1 + Math.floor(Math.random() * 600)}`).expect(200);
    g1 = list.body.data.items[0].id;
    g2 = list.body.data.items[1].id;
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const closer = () => e2e.app.get(ProgramWeekCloseService);
  const points = async () => (await e2e.as(ana.token).get('/me/progression').expect(200)).body.data.points as number;

  async function trainToday(routineId: string, sets: Record<string, Array<[number, number]>>) {
    const api = e2e.as(ana.token);
    const started = await api.post(`/routines/${routineId}/start`).send({}).expect(201);
    const sessionId = started.body.data.id as string;
    const detail = await api.get(`/workouts/${sessionId}`).expect(200);
    for (const se of detail.body.data.ejercicios) {
      for (const [i, [reps, kg]] of (sets[se.ejercicio.id as string] ?? []).entries()) {
        await api.post(`/workouts/session-exercises/${se.id}/sets`).send({ numeroSerie: i + 1, repeticiones: reps, pesoKg: kg, rir: 2, descansoSegAnterior: 60 }).expect(201);
      }
    }
    await e2e.sql(`UPDATE public.sesiones_entrenamiento SET fecha_inicio = now() - interval '30 minutes' WHERE id = :sessionId`, { sessionId });
    const finished = await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200);
    return finished.body.data as Record<string, unknown>;
  }

  const mkRoutine = async (name: string) =>
    (
      await e2e
        .as(ana.token)
        .post('/routines')
        .send({
          nombre: `${name} ${Date.now()}`,
          duracionSemanas: 4,
          dias: [{ diaSemana: todayIso, ejercicios: [g1, g2].map((id) => ({ ejercicioId: id, seriesObjetivo: 3, repsMin: 6, repsMax: 8, pesoObjetivoKg: 60 })) }],
        })
        .expect(201)
    ).body.data.id as string;

  describe('multiplicador semanal', () => {
    let routineId = '';
    let programId = '';
    let afterWeek1 = 0;

    it('una semana cumplida sube el multiplicador y paga un bono; los puntos del modo suman', async () => {
      routineId = await mkRoutine('Semana');
      const act = await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId, modo: 'PROGRESSIVE_OVERLOAD', diasSemana: [todayIso] }).expect(201);
      programId = act.body.data.id;
      expect(act.body.data.sesionesPlanSemana).toBe(1);
      await trainToday(routineId, { [g1]: [[8, 60], [8, 60], [8, 60]], [g2]: [[8, 60], [8, 60], [8, 60]] });
      const before = await points();

      const closed = await closer().closeProgram(programId, dayOffset(8));
      const week1 = closed.find((c) => c.weekNumber === 1);
      expect(week1).toMatchObject({ fulfilled: true, multiplier: 1.2 });
      expect(week1!.bonus).toBeGreaterThan(0);

      afterWeek1 = await points();
      expect(afterWeek1 - before).toBe(week1!.bonus); // el libro suma una línea propia
      const rewards = (await e2e.as(ana.token).get(`/programs/${programId}/progress`).expect(200)).body.data;
      expect(rewards.programa.multiplicador).toBe(1.2);
      expect(rewards.semanas[0]).toMatchObject({ cumplida: true, multiplicador: 1.2 });
    });

    it('cerrar dos veces no paga dos veces (idempotente)', async () => {
      await closer().closeProgram(programId, dayOffset(8));
      await closer().closeProgram(programId, dayOffset(8));
      expect(await points()).toBe(afterWeek1);
    });

    it('una semana vencida sin cumplir devuelve el multiplicador a 1,0 y NO quita puntos', async () => {
      const closed = await closer().closeProgram(programId, dayOffset(15));
      const week2 = closed.find((c) => c.weekNumber === 2);
      expect(week2).toMatchObject({ fulfilled: false, multiplier: 1, bonus: 0 });
      expect(await points()).toBe(afterWeek1);
      const view = (await e2e.as(ana.token).get('/programs/active').expect(200)).body.data.fuerza;
      expect(view.multiplicador).toBe(1);
    });

    it('si el trabajo estuvo caído, la pasada siguiente cierra todas las semanas pendientes en orden (caso 10)', async () => {
      const closed = await closer().closeProgram(programId, dayOffset(60));
      expect(closed.map((c) => c.weekNumber)).toEqual([...closed.map((c) => c.weekNumber)].sort((a, b) => a - b));
      const progress = (await e2e.as(ana.token).get(`/programs/${programId}/progress`).expect(200)).body.data;
      expect(progress.semanas.length).toBeGreaterThanOrEqual(5);
      // Toda semana con sesiones planeadas queda cumplida o no; las de plan 0 se cierran sin pagar ni penalizar.
      expect(
        progress.semanas.every((w: { cumplida: boolean | null; sesionesPlan: number }) => w.cumplida !== null || w.sesionesPlan === 0),
      ).toBe(true);
      expect(progress.semanas.filter((w: { cumplida: boolean }) => w.cumplida)).toHaveLength(1);
      expect(progress.programa.estado).toBe('FINISHED');
      expect(progress.programa.motivoCierre).toBe('COMPLETED');
      expect(await points()).toBe(afterWeek1); // 1 de 5 semanas cumplidas: sin bono de programa
    });

    it('sin modo no hay multiplicador ni bonos', async () => {
      const r = await mkRoutine('SinModo');
      const act = await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId: r, modo: 'NONE', diasSemana: [todayIso] }).expect(201);
      await trainToday(r, { [g1]: [[8, 60], [8, 60], [8, 60]] });
      const before = await points();
      await closer().closeProgram(act.body.data.id, dayOffset(8));
      const after = await points();
      expect(after).toBe(before);
      await e2e.as(ana.token).post(`/programs/${act.body.data.id}/stop`).expect(201);
    });
  });

  describe('cardio', () => {
    let planId = '';

    it('crea un plan con FC máxima, lo activa junto al de pesas y suma minutos de cardio', async () => {
      const r = await mkRoutine('Pesas con cardio');
      await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId: r, modo: 'NONE', diasSemana: [todayIso], replace: true }).expect(201);
      const plan = await e2e
        .as(ana.token)
        .post('/cardio-plans')
        .send({ nombre: 'Trote suave', modalidad: 'CORRER', diasSemana: [todayIso], minutosObjetivo: 30, intensidad: { tipo: 'ZONA_FC', zona: 2 }, fcMax: 190, progresionPctSemana: 5 })
        .expect(201);
      planId = plan.body.data.id;
      expect(plan.body.data).toMatchObject({ minutosObjetivo: 30, fcMax: 190 });
      const act = await e2e.as(ana.token).post('/programs/cardio/activate').send({ cardioPlanId: planId, duracionSemanas: 4 }).expect(201);
      expect(act.body.data).toMatchObject({ carril: 'CARDIO', modo: 'CARDIO' });
      const active = await e2e.as(ana.token).get('/programs/active').expect(200);
      expect(active.body.data.fuerza).not.toBeNull();
      expect(active.body.data.cardio.id).toBe(act.body.data.id);
      await e2e.as(ana.token).post('/programs/cardio/activate').send({ cardioPlanId: planId }).expect(409);
    });

    it('una sesión con series de cardio cuenta minutos en la zona y no altera el volumen de fuerza', async () => {
      const api = e2e.as(ana.token);
      const stats = async () => (await api.get('/me/progression').expect(200)).body.data.stats as { totalVolumeKg: number; totalSets: number };
      const before = await stats();
      expect(before.totalVolumeKg).toBeGreaterThan(0); // hay entrenamiento de fuerza previo: la comparación no es vacía
      const started = await api.post('/workouts').send({ observacion: 'cardio' }).expect(201);
      const sessionId = started.body.data.id as string;
      const ex = await api.post(`/workouts/${sessionId}/exercises`).send({ ejercicioId: g1, orden: 1, esEnfasis: false }).expect(201);
      await api
        .post(`/workouts/session-exercises/${ex.body.data.id}/sets`)
        .send({ tipoSerie: 'CARDIO', numeroSerie: 1, duracionSeg: 1800, fcMedia: 125, distanciaM: 4500 })
        .expect(201);
      // Una serie de cardio inválida (sin duración) se rechaza.
      await api.post(`/workouts/session-exercises/${ex.body.data.id}/sets`).send({ tipoSerie: 'CARDIO', numeroSerie: 2 }).expect(400);
      const finished = (await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200)).body.data;
      expect(finished.cardio).toMatchObject({ sesionCuenta: true, minutosCuentan: 30, cumpleObjetivoSesion: true });
      const detail = (await api.get(`/workouts/${sessionId}`).expect(200)).body.data;
      expect(detail.ejercicios[0].series[0]).toMatchObject({ tipoSerie: 'CARDIO', duracionSeg: 1800, repeticiones: null, pesoKg: null });
      const after = await stats();
      expect(after.totalVolumeKg).toBe(before.totalVolumeKg);
      expect(after.totalSets).toBe(before.totalSets); // una serie de cardio no es una serie de fuerza
    });

    it('por debajo de la zona objetivo los minutos no cuentan', async () => {
      const api = e2e.as(ana.token);
      const started = await api.post('/workouts').send({ observacion: 'cardio flojo' }).expect(201);
      const ex = await api.post(`/workouts/${started.body.data.id}/exercises`).send({ ejercicioId: g2, orden: 1, esEnfasis: false }).expect(201);
      await api.post(`/workouts/session-exercises/${ex.body.data.id}/sets`).send({ tipoSerie: 'CARDIO', numeroSerie: 1, duracionSeg: 1800, fcMedia: 100 }).expect(201);
      const finished = (await api.patch(`/workouts/${started.body.data.id}/finish`).send({}).expect(200)).body.data;
      expect(finished.cardio.minutosCuentan).toBe(0);
    });

    it('el cierre semanal del cardio compara minutos contra objetivo × sesiones', async () => {
      const active = (await e2e.as(ana.token).get('/programs/active').expect(200)).body.data.cardio;
      const closed = await closer().closeProgram(active.id, dayOffset(8));
      expect(closed[0]).toMatchObject({ weekNumber: 1, fulfilled: true });
    });

    it('un plan ajeno responde 404 y los valores fuera de rango 400', async () => {
      const other = await e2e.register('rew-other');
      await e2e.as(other.token).patch(`/cardio-plans/${planId}`).send({ nombre: 'Robado' }).expect(404);
      await e2e.as(ana.token).post('/cardio-plans').send({ nombre: 'X', modalidad: 'CORRER', diasSemana: [1], minutosObjetivo: 3, intensidad: { tipo: 'RPE', rpe: 5 } }).expect(400);
      await e2e.as(ana.token).post('/cardio-plans').send({ nombre: 'Plan malo', modalidad: 'CORRER', diasSemana: [1], minutosObjetivo: 30, intensidad: { tipo: 'RPE', rpe: 11 } }).expect(400);
    });
  });

  it('compatibilidad: la serie de fuerza SIN tipoSerie (app instalada) sigue funcionando', async () => {
    const api = e2e.as(ana.token);
    const started = await api.post('/workouts').send({ observacion: 'vieja' }).expect(201);
    const ex = await api.post(`/workouts/${started.body.data.id}/exercises`).send({ ejercicioId: g1, orden: 1, esEnfasis: false }).expect(201);
    const set = await api.post(`/workouts/session-exercises/${ex.body.data.id}/sets`).send({ numeroSerie: 1, repeticiones: 5, pesoKg: 80, rir: 2, descansoSegAnterior: 90 }).expect(201);
    expect(set.body.data).toMatchObject({ tipoSerie: 'FUERZA', repeticiones: 5, pesoKg: 80 });
    await api.patch(`/workouts/${started.body.data.id}/cancel`).expect(200);
  });
});
