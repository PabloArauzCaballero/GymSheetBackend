import { SupportTrainingService } from '../src/modules/programs/support-training.service';
import { ProgramWeekCloseService } from '../src/modules/programs/program-week-close.service';
import { bootE2eApp, E2eApp } from './support/e2e-app';

/** RF-B3 · soporte: ver el entrenamiento de un socio y recalcular una semana sin bajar puntos. */
describe('Support training view (e2e)', () => {
  let e2e: E2eApp;
  let member: { token: string; id: string };
  let sys: { token: string; id: string };
  let gymAdmin: { token: string; id: string };
  let g1 = '';
  let programId = '';
  const todayIso = (() => {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  })();
  const dayOffset = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    e2e = await bootE2eApp();
    member = await e2e.register('sup-member');
    sys = await e2e.register('sup-sys');
    gymAdmin = await e2e.register('sup-admin');
    await e2e.promote(sys.id, 'SYSTEM_ADMIN');
    await e2e.promote(gymAdmin.id, 'ADMIN');
    const list = await e2e.as(member.token).get(`/exercises?pageSize=1&page=${1 + Math.floor(Math.random() * 1000)}`).expect(200);
    g1 = list.body.data.items[0].id;
    const r = await e2e
      .as(member.token)
      .post('/routines')
      .send({ nombre: `Soporte ${Date.now()}`, duracionSemanas: 4, dias: [{ diaSemana: todayIso, ejercicios: [{ ejercicioId: g1, seriesObjetivo: 1 + Math.floor(Math.random() * 90) }] }] })
      .expect(201);
    const act = await e2e.as(member.token).post('/programs/strength/activate').send({ routineId: r.body.data.id, modo: 'PROGRESSIVE_OVERLOAD', diasSemana: [todayIso] }).expect(201);
    programId = act.body.data.id;
    // Semana 1 vence SIN cumplir (no entrenó): el socio «pierde» su multiplicador.
    await e2e.app.get(ProgramWeekCloseService).closeProgram(programId, dayOffset(8));
  }, 90000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  it('un socio normal no entra a la vista de soporte', async () => {
    await e2e.as(member.token).get(`/admin/support/users/${member.id}/training`).expect(403);
  });

  it('un ADMIN de gimnasio sin el permiso support:read tampoco', async () => {
    await e2e.as(gymAdmin.token).get(`/admin/support/users/${member.id}/training`).expect(403);
  });

  it('SYSTEM_ADMIN ve programas, semanas, bonos, invitaciones y últimas sesiones', async () => {
    const res = await e2e.as(sys.token).get(`/admin/support/users/${member.id}/training`).expect(200);
    const data = res.body.data;
    expect(data.usuarioId).toBe(member.id);
    expect(data.programas[0]).toMatchObject({ id: programId, modo: 'PROGRESSIVE_OVERLOAD' });
    expect(data.programas[0].semanas[0]).toMatchObject({ numero: 1, cumplida: false });
    expect(data.rutinas.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.invitaciones)).toBe(true);
    expect(Array.isArray(data.ultimasSesiones)).toBe(true);
    expect(data.puntosDeModo).toBe(0);
  });

  it('un usuario inexistente responde 404', async () => {
    await e2e.as(sys.token).get('/admin/support/users/00000000-0000-0000-0000-00000000dead/training').expect(404);
  });

  it('recalcular una semana que sigue sin cumplirse no cambia nada; una abierta tampoco', async () => {
    // Con el reloj real la semana 1 todavía está abierta; el reloj simulado la deja vencida.
    const live = await e2e.as(sys.token).post(`/admin/support/programs/${programId}/recompute-week`).send({ semana: 1 }).expect(201);
    expect(live.body.data).toMatchObject({ recalculada: false, motivo: 'SEMANA_ABIERTA' });
    const res = await e2e.app.get(SupportTrainingService).recomputeWeek(programId, 1, null, dayOffset(8));
    expect(res).toMatchObject({ recalculada: false, motivo: 'SIGUE_SIN_CUMPLIR' });
    await e2e.as(sys.token).post(`/admin/support/programs/${programId}/recompute-week`).send({ semana: 0 }).expect(400);
  });

  it('cuando hay trabajo que no se contó, recalcular otorga el bono que faltaba UNA sola vez y nunca baja puntos', async () => {
    // El socio sí entrenó esa semana, pero la sesión no llegó a contarse (p. ej. se terminó desde otro dispositivo).
    const api = e2e.as(member.token);
    const started = await api.post('/workouts').send({}).expect(201);
    const sessionId = started.body.data.id as string;
    const ex = await api.post(`/workouts/${sessionId}/exercises`).send({ ejercicioId: g1, orden: 1, esEnfasis: false }).expect(201);
    for (let i = 1; i <= 3; i += 1) {
      await api.post(`/workouts/session-exercises/${ex.body.data.id}/sets`).send({ numeroSerie: i, repeticiones: 8, pesoKg: 50, rir: 2, descansoSegAnterior: 60 }).expect(201);
    }
    await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200);
    await e2e.sql(
      `UPDATE public.sesiones_entrenamiento SET program_id = :programId, fecha_inicio = now() - interval '40 minutes' WHERE id = :sessionId`,
      { programId, sessionId },
    );
    const before = (await api.get('/me/progression').expect(200)).body.data.points as number;

    const support = e2e.app.get(SupportTrainingService);
    const first = await support.recomputeWeek(programId, 1, null, dayOffset(8));
    expect(first.recalculada).toBe(true);
    const after = (await api.get('/me/progression').expect(200)).body.data.points as number;
    expect(after).toBeGreaterThan(before);

    const again = await support.recomputeWeek(programId, 1, null, dayOffset(8));
    expect(again).toMatchObject({ recalculada: false, motivo: 'YA_CUMPLIDA' });
    expect((await api.get('/me/progression').expect(200)).body.data.points).toBe(after);
  });
});
