import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-11/RF-12/RF-B1 · valoraciones, comentarios, denuncias y ocultado de rutinas, ejercicios y comentarios. */
describe('Community and moderation of routines (e2e)', () => {
  let e2e: E2eApp;
  let ana: { token: string; id: string };
  let people: Array<{ token: string; id: string }> = [];
  let admin: { token: string; id: string };
  let exerciseId = '';
  let routineId = '';

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('com-ana');
    people = [];
    for (const label of ['com-p1', 'com-p2', 'com-p3', 'com-p4']) people.push(await e2e.register(label));
    admin = await e2e.register('com-admin');
    await e2e.promote(admin.id, 'SYSTEM_ADMIN');
    exerciseId = await createPersonalExercise(e2e.as(ana.token), `Com ${Date.now()}`);
    const created = await e2e
      .as(ana.token)
      .post('/routines')
      .send({ nombre: `Comunidad ${Date.now()}`, dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: exerciseId }] }] })
      .expect(201);
    routineId = created.body.data.id;
    await e2e.as(ana.token).post(`/routines/${routineId}/publish`).expect(201);
  }, 90000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const inbox = async (token: string) => JSON.stringify((await e2e.as(token).get('/notifications/me').expect(200)).body.data);

  describe('valoraciones', () => {
    it('otra persona valora, el promedio se recalcula y la autora no puede valorar la suya', async () => {
      const first = await e2e.as(people[0].token).put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 5 }).expect(200);
      expect(first.body.data).toMatchObject({ promedio: 5, total: 1, miValoracion: 5 });
      const second = await e2e.as(people[1].token).put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 2 }).expect(200);
      expect(second.body.data).toMatchObject({ promedio: 3.5, total: 2 });
      const changed = await e2e.as(people[1].token).put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 4 }).expect(200);
      expect(changed.body.data).toMatchObject({ promedio: 4.5, total: 2 });
      const own = await e2e.as(ana.token).put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 5 }).expect(400);
      expect(own.body.code).toBe('CANNOT_RATE_OWN');
      await e2e.as(people[0].token).put(`/ratings/ROUTINE/${routineId}`).send({ estrellas: 6 }).expect(400);
      const detail = await e2e.as(people[2].token).get(`/routines/${routineId}`).expect(200);
      expect(detail.body.data.valoracion).toEqual({ promedio: 4.5, total: 2 });
    });

    it('quitar la valoración recalcula; el resumen trae la mía', async () => {
      const removed = await e2e.as(people[1].token).del(`/ratings/ROUTINE/${routineId}`).expect(200);
      expect(removed.body.data).toMatchObject({ promedio: 5, total: 1, miValoracion: null });
      const mine = await e2e.as(people[0].token).get(`/ratings/ROUTINE/${routineId}`).expect(200);
      expect(mine.body.data.miValoracion).toBe(5);
    });

    it('un ejercicio privado se valora desde una rutina pública, no su dueña', async () => {
      const res = await e2e.as(people[0].token).put(`/ratings/EXERCISE/${exerciseId}`).send({ estrellas: 4 }).expect(200);
      expect(res.body.data).toMatchObject({ promedio: 4, total: 1 });
      await e2e.as(ana.token).put(`/ratings/EXERCISE/${exerciseId}`).send({ estrellas: 5 }).expect(400);
    });

    it('lo que no ves no se valora (404)', async () => {
      const priv = await e2e.as(ana.token).post('/routines').send({ nombre: 'Solo mía' }).expect(201);
      await e2e.as(people[0].token).put(`/ratings/ROUTINE/${priv.body.data.id}`).send({ estrellas: 3 }).expect(404);
      await e2e.as(people[0].token).get(`/comments/ROUTINE/${priv.body.data.id}`).expect(404);
    });
  });

  describe('comentarios', () => {
    let commentId = '';

    it('comentar y responder un solo nivel; la autora recibe el aviso', async () => {
      const root = await e2e.as(people[0].token).post(`/comments/ROUTINE/${routineId}`).send({ texto: '  Me encantó  ' }).expect(201);
      commentId = root.body.data.id;
      expect(root.body.data.texto).toBe('Me encantó');
      const reply = await e2e.as(ana.token).post(`/comments/ROUTINE/${routineId}`).send({ texto: 'Gracias', respuestaA: commentId }).expect(201);
      await e2e.as(people[1].token).post(`/comments/ROUTINE/${routineId}`).send({ texto: 'Anidada', respuestaA: reply.body.data.id }).expect(400);
      await e2e.as(people[1].token).post(`/comments/ROUTINE/${routineId}`).send({ texto: '' }).expect(400);
      await e2e.as(people[1].token).post(`/comments/ROUTINE/${routineId}`).send({ texto: 'x'.repeat(1001) }).expect(400);
      expect(await inbox(ana.token)).toContain('ROUTINE_COMMENT');
    });

    it('la lista trae los comentarios con sus respuestas anidadas', async () => {
      const res = await e2e.as(people[2].token).get(`/comments/ROUTINE/${routineId}`).expect(200);
      const top = res.body.data.items.find((c: { id: string }) => c.id === commentId);
      expect(top.respuestas).toHaveLength(1);
      expect(top.respuestas[0].texto).toBe('Gracias');
      expect(top.esMio).toBe(false);
    });

    it('solo el autor borra su comentario', async () => {
      await e2e.as(people[1].token).del(`/comments/${commentId}`).expect(404);
      await e2e.as(people[0].token).del(`/comments/${commentId}`).expect(200);
      const res = await e2e.as(people[2].token).get(`/comments/ROUTINE/${routineId}`).expect(200);
      expect(res.body.data.items.some((c: { id: string }) => c.id === commentId)).toBe(false);
    });

    it('más de 10 comentarios por minuto devuelve 429', async () => {
      const spammer = people[3];
      let last = 0;
      for (let i = 0; i < 12; i += 1) {
        last = (await e2e.as(spammer.token).post(`/comments/ROUTINE/${routineId}`).send({ texto: `spam ${i}` })).status;
        if (last === 429) break;
      }
      expect(last).toBe(429);
    });
  });

  describe('denuncias y moderación', () => {
    it('la cola de moderación acepta casos de rutina (3 denunciantes distintos la ocultan)', async () => {
      const [p1, p2, p3] = people;
      const r1 = await e2e.as(p1.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: routineId, reason: 'INFORMACION_ENGANOSA' }).expect(201);
      expect(r1.body.data.contentHidden).toBe(false);
      await e2e.as(p1.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: routineId, reason: 'PLAGIO' }).expect(409);
      await e2e.as(p2.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: routineId, reason: 'PLAGIO' }).expect(201);
      const r3 = await e2e.as(p3.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: routineId, reason: 'EJERCICIO_PELIGROSO' }).expect(201);
      expect(r3.body.data.contentHidden).toBe(true);

      const seenByOthers = await e2e.as(people[3].token).get(`/routines/${routineId}`);
      expect(seenByOthers.status).toBe(404);
      const authorView = await e2e.as(ana.token).get(`/routines/${routineId}`).expect(200);
      expect(authorView.body.data.estadoModeracion).toBe('OCULTA_AUTO');
      const catalog = await e2e.as(people[3].token).get('/routines?scope=public&limit=50').expect(200);
      expect(JSON.stringify(catalog.body)).not.toContain(routineId);

      const queue = await e2e.as(admin.token).get('/admin/moderation/queue?pageSize=50').expect(200);
      const entry = JSON.stringify(queue.body);
      expect(entry).toContain(routineId);
    });

    it('un moderador ve el caso, lo resuelve ocultando y la autora recibe CONTENT_HIDDEN', async () => {
      const kase = await e2e.as(admin.token).get(`/admin/moderation/cases/ROUTINE/${routineId}`).expect(200);
      expect(kase.body.data.contentHidden).toBe(true);
      expect(kase.body.data.reports).toHaveLength(3);
      await e2e.as(admin.token).post(`/admin/moderation/cases/ROUTINE/${routineId}/claim`).expect(201);
      const res = await e2e
        .as(admin.token)
        .post(`/admin/moderation/cases/ROUTINE/${routineId}/resolve`)
        .send({ hideContent: true, sanction: false, note: 'Ejercicio inseguro' })
        .expect(201);
      expect(res.body.data.contentHidden).toBe(true);
      const authorView = await e2e.as(ana.token).get(`/routines/${routineId}`).expect(200);
      expect(authorView.body.data.estadoModeracion).toBe('OCULTA_MODERACION');
      expect(await inbox(ana.token)).toContain('CONTENT_HIDDEN');
    });

    it('no se puede publicar de nuevo una rutina oculta por moderación', async () => {
      const res = await e2e.as(ana.token).post(`/routines/${routineId}/publish`).expect(403);
      expect(res.body.code).toBe('CONTENT_HIDDEN');
    });

    it('denunciar contenido que no puedes ver o que es tuyo responde 404/409', async () => {
      const priv = await e2e.as(ana.token).post('/routines').send({ nombre: 'Privada denuncia' }).expect(201);
      await e2e.as(people[0].token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: priv.body.data.id, reason: 'SPAM' }).expect(404);
      await e2e.as(ana.token).post('/me/reports').send({ targetKind: 'ROUTINE', targetId: priv.body.data.id, reason: 'SPAM' }).expect(409);
      await e2e.as(people[0].token).post('/me/reports').send({ targetKind: 'EXERCISE', targetId: exerciseId, reason: 'SPAM' }).expect(404); // la rutina pública está oculta
    });

    it('un comentario se denuncia y la moderación lo oculta', async () => {
      const other = await e2e.as(people[0].token).post('/routines').send({ nombre: 'Para comentarios' }).expect(201);
      expect(other.body.data.id).toBeDefined();
      const ex = await createPersonalExercise(e2e.as(ana.token), `Com2 ${Date.now()}`);
      const pub = await e2e.as(ana.token).post('/routines').send({ nombre: `Pública com2 ${Date.now()}`, dias: [{ diaSemana: 3, ejercicios: [{ ejercicioId: ex }] }] }).expect(201);
      await e2e.as(ana.token).post(`/routines/${pub.body.data.id}/publish`).expect(201);
      const c = await e2e.as(people[0].token).post(`/comments/ROUTINE/${pub.body.data.id}`).send({ texto: 'Comentario ofensivo' }).expect(201);
      await e2e.as(people[1].token).post('/me/reports').send({ targetKind: 'COMMENT', targetId: c.body.data.id, reason: 'ACOSO' }).expect(201);
      await e2e.as(admin.token).post(`/admin/moderation/cases/COMMENT/${c.body.data.id}/claim`).expect(201);
      await e2e.as(admin.token).post(`/admin/moderation/cases/COMMENT/${c.body.data.id}/resolve`).send({ hideContent: true, sanction: false }).expect(201);
      const list = await e2e.as(people[2].token).get(`/comments/ROUTINE/${pub.body.data.id}`).expect(200);
      expect(list.body.data.items).toHaveLength(0);
    });
  });
});

describe('Moderación de ejercicios privados (e2e)', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, 60000);
  afterAll(async () => {
    await e2e.app?.close();
  });

  it('ocultar un ejercicio desde la cola responde 201 y lo deja OCULTO_MODERACION; restaurar lo devuelve a VISIBLE', async () => {
    const owner = await e2e.register('exmod-owner');
    const admin = await e2e.register('exmod-admin');
    await e2e.promote(admin.id, 'SYSTEM_ADMIN');
    const reporters = [await e2e.register('exmod-r1')];
    const exerciseId = await createPersonalExercise(e2e.as(owner.token), `Mod ex ${Date.now()}`);
    const routine = await e2e
      .as(owner.token)
      .post('/routines')
      .send({ nombre: `Con ejercicio ${Date.now()}`, dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: exerciseId, seriesObjetivo: 1 + Math.floor(Math.random() * 90) }] }] })
      .expect(201);
    await e2e.as(owner.token).post(`/routines/${routine.body.data.id}/publish`).expect(201);
    await e2e.as(reporters[0].token).post('/me/reports').send({ targetKind: 'EXERCISE', targetId: exerciseId, reason: 'EJERCICIO_PELIGROSO' }).expect(201);
    await e2e.as(admin.token).post(`/admin/moderation/cases/EXERCISE/${exerciseId}/claim`).expect(201);
    await e2e.as(admin.token).post(`/admin/moderation/cases/EXERCISE/${exerciseId}/resolve`).send({ hideContent: true, sanction: false }).expect(201);
    const [hidden] = await e2e.app.get(Sequelize).query<{ s: string }>('SELECT estado_moderacion AS s FROM public.ejercicios WHERE id = :exerciseId', { type: QueryTypes.SELECT, replacements: { exerciseId } });
    expect(hidden.s).toBe('OCULTO_MODERACION');
    await e2e.as(reporters[0].token).post('/me/reports').send({ targetKind: 'EXERCISE', targetId: exerciseId, reason: 'SPAM' }).expect(404);
  });
});
