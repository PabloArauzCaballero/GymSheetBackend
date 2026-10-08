import { bootE2eApp, E2eApp } from './support/e2e-app';

/** RF-14..16, RF-19, RF-20 · activar programas, doble progresión, metas, cierre y actualizar la rutina. */
describe('Programs (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let leo: { token: string; id: string };
  let g1 = '';
  let g2 = '';
  const todayIso = (() => {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  })();

  const routineBody = (nombre: string, exercises: string[]) => ({
    nombre,
    objetivo: 'FUERZA',
    duracionSemanas: 4,
    progresion: { activa: true, descargaCada: 4 },
    dias: [
      { diaSemana: todayIso, ejercicios: exercises.map((id) => ({ ejercicioId: id, seriesObjetivo: 3, repsMin: 6, repsMax: 8, pesoObjetivoKg: 60 })) },
      { diaSemana: todayIso === 7 ? 3 : todayIso + 1 > 7 ? 1 : todayIso + 1, ejercicios: [{ ejercicioId: exercises[0], seriesObjetivo: 3 }] },
    ],
  });

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('prog-ana');
    leo = await e2e.register('prog-leo');
    const page = 1 + Math.floor(Math.random() * 600);
    const list = await e2e.as(ana.token).get(`/exercises?pageSize=2&page=${page}`).expect(200);
    g1 = list.body.data.items[0].id;
    g2 = list.body.data.items[1].id;
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  /** Empieza la sesión desde la rutina, registra series, la retrasa 15 min y la termina. */
  async function trainSession(token: string, routineId: string, plan: Record<string, Array<[number, number]>>) {
    const api = e2e.as(token);
    const started = await api.post(`/routines/${routineId}/start`).send({}).expect(201);
    const sessionId = started.body.data.id as string;
    const detail = await api.get(`/workouts/${sessionId}`).expect(200);
    for (const se of detail.body.data.ejercicios) {
      const sets = plan[se.ejercicio.id as string] ?? [];
      for (const [i, [reps, kg]] of sets.entries()) {
        await api
          .post(`/workouts/session-exercises/${se.id}/sets`)
          .send({ numeroSerie: i + 1, repeticiones: reps, pesoKg: kg, rir: 2, descansoSegAnterior: 90 })
          .expect(201);
      }
    }
    await e2e.sql(`UPDATE public.sesiones_entrenamiento SET fecha_inicio = now() - interval '25 minutes' WHERE id = :sessionId`, { sessionId });
    const finished = await api.patch(`/workouts/${sessionId}/finish`).send({}).expect(200);
    return { sessionId, finished: finished.body.data };
  }

  describe('sobrecarga progresiva', () => {
    let routineId = '';
    let programId = '';

    it('activa un programa con agenda, semanas y metas por ejercicio', async () => {
      const created = await e2e.as(ana.token).post('/routines').send(routineBody(`Prog ${Date.now()}`, [g1, g2])).expect(201);
      routineId = created.body.data.id;
      const res = await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId, modo: 'PROGRESSIVE_OVERLOAD' }).expect(201);
      const p = res.body.data;
      programId = p.id;
      expect(p).toMatchObject({ carril: 'STRENGTH', modo: 'PROGRESSIVE_OVERLOAD', estado: 'ACTIVE', multiplicador: 1, rutinaId: routineId });
      expect(p.semanasTotales).toBeGreaterThanOrEqual(4);
      expect(p.semanaActual).toBe(1);
      expect(p.sesionesPlanSemana).toBeGreaterThanOrEqual(1);
      expect(p.metas).toHaveLength(2);
      expect(p.metas[0]).toMatchObject({ pesoSugeridoKg: 60, repsMin: 6, repsMax: 8 });
      const active = await e2e.as(ana.token).get('/programs/active').expect(200);
      expect(active.body.data.fuerza.id).toBe(programId);
      expect(active.body.data.cardio).toBeNull();
      const agenda = await e2e.as(ana.token).get('/routines/assignments/me').expect(200);
      const mine = agenda.body.data.find((a: { rutinaId: string }) => a.rutinaId === routineId);
      expect(mine.diasSemana).toContain(todayIso === 7 ? 0 : todayIso);
    });

    it('otro programa de fuerza activo devuelve 409 con el activo; replace lo cierra como REPLACED', async () => {
      const other = await e2e.as(ana.token).post('/routines').send(routineBody(`Otra ${Date.now()}`, [g2])).expect(201);
      const conflict = await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId: other.body.data.id, modo: 'NONE' }).expect(409);
      expect(conflict.body.code).toBe('PROGRAM_ACTIVE_CONFLICT');
      expect(conflict.body.details.activeProgram).toMatchObject({ id: programId, semanasTotales: expect.any(Number) });
      const replaced = await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId: other.body.data.id, modo: 'NONE', replace: true }).expect(201);
      expect(replaced.body.data.modo).toBe('NONE');
      const old = await e2e.as(ana.token).get(`/programs/${programId}/progress`).expect(200);
      expect(old.body.data.programa).toMatchObject({ estado: 'STOPPED', motivoCierre: 'REPLACED' });
      const agenda = await e2e.as(ana.token).get('/routines/assignments/me').expect(200);
      expect(agenda.body.data.some((a: { rutinaId: string }) => a.rutinaId === routineId)).toBe(false);
      await e2e.as(ana.token).post(`/programs/${replaced.body.data.id}/stop`).expect(201);
    });

    it('dos activaciones simultáneas: una gana y la otra recibe 409', async () => {
      const a = await e2e.as(leo.token).post('/routines').send(routineBody(`Carrera A ${Date.now()}`, [g1])).expect(201);
      const b = await e2e.as(leo.token).post('/routines').send(routineBody(`Carrera B ${Date.now()}`, [g2])).expect(201);
      const [r1, r2] = await Promise.all([
        e2e.as(leo.token).post('/programs/strength/activate').send({ routineId: a.body.data.id, modo: 'NONE' }),
        e2e.as(leo.token).post('/programs/strength/activate').send({ routineId: b.body.data.id, modo: 'NONE' }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      const active = await e2e.as(leo.token).get('/programs/active').expect(200);
      expect(active.body.data.fuerza).not.toBeNull();
    });

    it('al terminar una sesión con todas las series en el tope sube el peso sugerido', async () => {
      const again = await e2e.as(ana.token).post('/programs/strength/activate').send({ routineId, modo: 'PROGRESSIVE_OVERLOAD' }).expect(201);
      programId = again.body.data.id;
      const { finished } = await trainSession(ana.token, routineId, {
        [g1]: [[8, 60], [8, 60], [8, 60]],
        [g2]: [[7, 60], [7, 60], [6, 60]],
      });
      const prog = finished.programa;
      expect(prog.sesionCuenta).toBe(true);
      expect(prog.bonusModo).toMatchObject({ multiplicador: 1, proximoMultiplicador: 1.2 });
      const raise = prog.sugerencias.find((s: { ejercicioId: string }) => s.ejercicioId === g1);
      expect(raise.accion).toBe('RAISE');
      expect(raise.pesoSugeridoKg).toBeGreaterThan(60);
      const hold = prog.sugerencias.find((s: { ejercicioId: string }) => s.ejercicioId === g2);
      expect(hold.accion).toBe('HOLD');
      const loads = await e2e.as(ana.token).get(`/programs/${programId}/next-loads`).expect(200);
      expect(loads.body.data.items.find((i: { ejercicioId: string }) => i.ejercicioId === g1).pesoSugeridoKg).toBe(raise.pesoSugeridoKg);
      expect(prog.sesionesHechasSemana).toBe(1);
    });

    it('una segunda sesión el mismo día no cuenta para la semana', async () => {
      const { finished } = await trainSession(ana.token, routineId, { [g1]: [[8, 60], [8, 60], [8, 60]] });
      expect(finished.programa.sesionCuenta).toBe(false);
      expect(finished.programa.motivoNoCuenta).toContain('hoy');
    });

    it('RF-20: lo hecho distinto a la rutina se propone y al aceptar se actualiza (semanas futuras incluidas)', async () => {
      const { finished } = await trainSession(ana.token, routineId, { [g1]: [[8, 70], [8, 70], [8, 70]], [g2]: [[8, 60], [8, 60], [8, 60]] });
      const prog = finished.programa;
      expect(prog.cambiosRespectoRutina).toBe(true);
      expect(prog.propuesta.cambios[0]).toMatchObject({ pesoObjetivoKg: 70 });
      const session = finished.id as string;
      const applied = await e2e.as(ana.token).post(`/workouts/${session}/apply-to-routine`).send(prog.propuesta).expect(201);
      const updated = applied.body.data.ejercicios.find((e: { ejercicio: { id: string } }) => e.ejercicio.id === g1);
      expect(updated.pesoObjetivoKg).toBe(70);
      const cal = await e2e.as(ana.token).get(`/routines/${routineId}/calendar`).expect(200);
      expect(cal.body.data.semanas[1].dias[0].ejercicios.find((e: { ejercicioId: string }) => e.ejercicioId === g1).pesoObjetivoKg).toBe(70);
      await e2e.as(leo.token).post(`/workouts/${session}/apply-to-routine`).send(prog.propuesta).expect(404);
    });

    it('un programa ajeno responde 404', async () => {
      await e2e.as(leo.token).get(`/programs/${programId}/progress`).expect(404);
      await e2e.as(leo.token).post(`/programs/${programId}/stop`).expect(404);
    });

    it('el cierre «repetir» crea otro programa con el peso sugerido actual como base (D6)', async () => {
      const before = await e2e.as(ana.token).get(`/programs/${programId}/next-loads`).expect(200);
      const suggested = before.body.data.items.find((i: { ejercicioId: string }) => i.ejercicioId === g1).pesoSugeridoKg;
      const res = await e2e.as(ana.token).post(`/programs/${programId}/close`).send({ accion: 'REPEAT' }).expect(201);
      expect(res.body.data.siguiente.metas.find((m: { ejercicioId: string }) => m.ejercicioId === g1).pesoTrabajoKg).toBe(suggested);
      const old = await e2e.as(ana.token).get(`/programs/${programId}/progress`).expect(200);
      expect(old.body.data.programa).toMatchObject({ estado: 'FINISHED', motivoCierre: 'REPEATED' });
      await e2e.as(ana.token).post(`/programs/${res.body.data.siguiente.id}/close`).send({ accion: 'STOP' }).expect(201);
    });
  });

  describe('metas de marca', () => {
    it('exige marca actual, meta y fecha, y una meta por encima de la marca', async () => {
      const r = await e2e.as(leo.token).post('/routines').send(routineBody(`Meta ${Date.now()}`, [g1])).expect(201);
      await e2e.as(leo.token).post('/programs/strength/stop').catch(() => undefined);
      const active = await e2e.as(leo.token).get('/programs/active').expect(200);
      if (active.body.data.fuerza) await e2e.as(leo.token).post(`/programs/${active.body.data.fuerza.id}/stop`).expect(201);
      await e2e.as(leo.token).post('/programs/strength/activate').send({ routineId: r.body.data.id, modo: 'STRENGTH_GOALS' }).expect(400);
      const date = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      await e2e
        .as(leo.token)
        .post('/programs/strength/activate')
        .send({ routineId: r.body.data.id, modo: 'STRENGTH_GOALS', liftTargets: [{ ejercicioId: g1, marcaMetaKg: 90, fechaMeta: date, marcaActual: { pesoKg: 100, reps: 5 } }] })
        .expect(400);
    });

    it('alcanzar la meta marca la fecha, avisa y no vuelve a avisar', async () => {
      const r = await e2e.as(leo.token).post('/routines').send(routineBody(`Meta2 ${Date.now()}`, [g1])).expect(201);
      const date = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const act = await e2e
        .as(leo.token)
        .post('/programs/strength/activate')
        .send({ routineId: r.body.data.id, modo: 'STRENGTH_GOALS', liftTargets: [{ ejercicioId: g1, marcaMetaKg: 110, fechaMeta: date, marcaActual: { pesoKg: 80, reps: 5 } }] })
        .expect(201);
      const lift = act.body.data.metas[0];
      expect(lift.marcaInicialKg).toBeCloseTo(93.33, 1);
      const { finished } = await trainSession(leo.token, r.body.data.id, { [g1]: [[3, 100], [3, 100], [3, 100]] });
      const goal = finished.programa.sugerencias.find((s: { accion: string }) => s.accion === 'GOAL_REACHED');
      expect(goal).toBeDefined();
      const inbox = JSON.stringify((await e2e.as(leo.token).get('/notifications/me').expect(200)).body.data);
      expect(inbox).toContain('GOAL_REACHED');
      const progress = await e2e.as(leo.token).get(`/programs/${act.body.data.id}/progress`).expect(200);
      expect(progress.body.data.programa.metas[0].alcanzadaEn).toBeTruthy();
    });
  });

  describe('rutina ajena', () => {
    it('activar la rutina pública de otra persona crea una copia privada (DD-1)', async () => {
      const page = 1 + Math.floor(Math.random() * 600);
      const list = await e2e.as(ana.token).get(`/exercises?pageSize=2&page=${page}`).expect(200);
      const [x1, x2] = [list.body.data.items[0].id, list.body.data.items[1].id];
      const pub = await e2e.as(ana.token).post('/routines').send(routineBody(`Pública ${Date.now()}`, [x1, x2])).expect(201);
      await e2e.as(ana.token).post(`/routines/${pub.body.data.id}/publish`).expect(201);
      const active = await e2e.as(leo.token).get('/programs/active').expect(200);
      if (active.body.data.fuerza) await e2e.as(leo.token).post(`/programs/${active.body.data.fuerza.id}/stop`).expect(201);
      const res = await e2e.as(leo.token).post('/programs/strength/activate').send({ routineId: pub.body.data.id, modo: 'PROGRESSIVE_OVERLOAD' }).expect(201);
      expect(res.body.data.rutinaId).not.toBe(pub.body.data.id);
      const copy = await e2e.as(leo.token).get(`/routines/${res.body.data.rutinaId}`).expect(200);
      expect(copy.body.data).toMatchObject({ visibilidad: 'PRIVATE', esMia: true, basadaEnRutinaId: pub.body.data.id });
      const source = await e2e.as(ana.token).get(`/routines/${pub.body.data.id}`).expect(200);
      expect(source.body.data.copias).toBe(1);
    });

    it('una privada ajena no se puede activar (404)', async () => {
      const priv = await e2e.as(ana.token).post('/routines').send(routineBody(`Privada ${Date.now()}`, [g1])).expect(201);
      await e2e.as(leo.token).post('/programs/strength/activate').send({ routineId: priv.body.data.id, modo: 'NONE', replace: true }).expect(404);
    });
  });
});
