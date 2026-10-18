import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

type Person = { token: string; id: string };
/** Textos únicos por ejecución: el ejercicio global se comparte entre corridas. */
const run = Date.now().toString(36);
const TIP = `Codos pegados al cuerpo ${run}`;
const QUESTION = `¿Cuántas series hacéis? ${run}`;

type Item = { id: string; texto: string; likes: number; esMio: boolean; respuestas: Item[] };

/**
 * Comentarios en la ficha de un ejercicio del catálogo (consejos, técnica, dudas):
 * `GET/POST /comments/EXERCISE/:id`, orden por recientes o por útiles, contador,
 * borrar el propio, «útil» (= me gusta), respuestas de un nivel, bloqueos y denuncias.
 */
describe('Comentarios de ejercicios (e2e)', () => {
  let e2e: E2eApp;
  let ana: Person;
  let beto: Person;
  let carla: Person;
  let dani: Person;
  let exerciseId = '';

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ana = await e2e.register('exc-ana');
    beto = await e2e.register('exc-beto');
    carla = await e2e.register('exc-carla');
    dani = await e2e.register('exc-dani');
    const [global] = await e2e.app.get(Sequelize).query<{ id: string }>(
      `SELECT id FROM public.ejercicios WHERE tipo_ejercicio = 'GLOBAL' AND estado = 'ACTIVO'
        AND estado_moderacion = 'VISIBLE'
        AND NOT EXISTS (SELECT 1 FROM community.content_comments c WHERE c.target_id = ejercicios.id)
        ORDER BY random() LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    exerciseId = global.id;
  }, 90000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  const list = async (who: Person, query = '') =>
    (await e2e.as(who.token).get(`/comments/EXERCISE/${exerciseId}${query}`).expect(200)).body.data as {
      items: Item[];
      siguienteCursor: string | null;
      total: number;
    };

  it('cualquiera comenta un ejercicio global; la lista trae autor, total y lo nuevo primero', async () => {
    const before = (await list(carla)).total;
    const first = await e2e.as(ana.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: TIP }).expect(201);
    expect(first.body.data).toMatchObject({ texto: TIP, esMio: true, likes: 0 });
    await e2e.as(beto.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: QUESTION }).expect(201);

    const page = await list(carla);
    expect(page.total).toBe(before + 2);
    expect(page.items[0].texto).toBe(QUESTION);
    expect(page.items[1].texto).toBe(TIP);
    expect(page.items[0].esMio).toBe(false);
  });

  it('valida el texto: vacío o de más de 1000 caracteres es 400; un ejercicio que no existe, 404', async () => {
    await e2e.as(ana.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: '   ' }).expect(400);
    await e2e.as(ana.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: 'x'.repeat(1001) }).expect(400);
    await e2e.as(ana.token).get('/comments/EXERCISE/00000000-0000-4000-8000-000000000000').expect(404);
    await e2e.as(ana.token).get(`/comments/EXERCISE/${exerciseId}?orden=mejores`).expect(400);
  });

  it('un ejercicio personal ajeno que no llega por ninguna rutina no se lee ni se comenta (404)', async () => {
    const own = await createPersonalExercise(e2e.as(ana.token), `Exc privado ${Date.now()}`);
    await e2e.as(ana.token).post(`/comments/EXERCISE/${own}`).send({ texto: 'Nota para mí' }).expect(201);
    await e2e.as(beto.token).get(`/comments/EXERCISE/${own}`).expect(404);
    await e2e.as(beto.token).post(`/comments/EXERCISE/${own}`).send({ texto: 'Hola' }).expect(404);
  });

  it('«útiles» ordena por me gusta y pagina con cursor sin repetir', async () => {
    const tip = (await list(carla)).items.find((c) => c.texto === TIP)!;
    await e2e.as(beto.token).put(`/comments/${tip.id}/like`).expect(200);
    await e2e.as(carla.token).put(`/comments/${tip.id}/like`).expect(200);

    const useful = await list(dani, '?orden=utiles&limit=1');
    expect(useful.items).toHaveLength(1);
    expect(useful.items[0]).toMatchObject({ id: tip.id, likes: 2 });
    expect(useful.siguienteCursor).not.toBeNull();
    const next = await list(dani, `?orden=utiles&limit=1&cursor=${encodeURIComponent(useful.siguienteCursor!)}`);
    expect(next.items[0].id).not.toBe(tip.id);
  });

  it('responder es de un solo nivel y el total cuenta las respuestas', async () => {
    const before = await list(dani);
    const question = before.items.find((c) => c.texto === QUESTION)!;
    const reply = await e2e.as(ana.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: 'Cuatro de diez', respuestaA: question.id }).expect(201);
    await e2e.as(carla.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: 'Anidada', respuestaA: reply.body.data.id }).expect(400);
    const after = await list(dani);
    expect(after.total).toBe(before.total + 1);
    expect(after.items.find((c) => c.id === question.id)!.respuestas.map((r) => r.texto)).toEqual(['Cuatro de diez']);
  });

  it('solo el autor borra el suyo; desaparece de la lista y del total', async () => {
    const mine = await e2e.as(dani.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: 'Lo borro enseguida' }).expect(201);
    const withIt = (await list(carla)).total;
    await e2e.as(carla.token).del(`/comments/${mine.body.data.id}`).expect(404);
    await e2e.as(dani.token).del(`/comments/${mine.body.data.id}`).expect(200);
    const page = await list(carla);
    expect(page.total).toBe(withIt - 1);
    expect(page.items.some((c) => c.id === mine.body.data.id)).toBe(false);
  });

  it('un bloqueo esconde los comentarios en los dos sentidos e impide responder o dar útil', async () => {
    const betoComment = (await list(ana)).items.find((c) => c.texto === QUESTION)!;
    const totalForAna = (await list(ana)).total;
    await e2e.as(ana.token).post('/me/blocks').send({ targetUserId: beto.id }).expect(201);

    const anaView = await list(ana);
    expect(anaView.items.some((c) => c.id === betoComment.id)).toBe(false);
    // El hilo de Beto se va entero (su comentario y la respuesta de Ana dentro).
    expect(anaView.total).toBe(totalForAna - 2);
    const betoView = await list(beto);
    expect(JSON.stringify(betoView.items)).not.toContain(TIP);

    await e2e.as(ana.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: 'Ojo', respuestaA: betoComment.id }).expect(400);
    await e2e.as(ana.token).put(`/comments/${betoComment.id}/like`).expect(404);

    // Quien no está en el bloqueo lo sigue viendo todo.
    expect((await list(carla)).items.some((c) => c.id === betoComment.id)).toBe(true);
  });

  it('se denuncia un comentario ajeno, el propio no, y uno de otro gimnasio también (ejercicio global)', async () => {
    const tip = (await list(carla)).items.find((c) => c.texto === TIP)!;
    await e2e.as(ana.token).post('/me/reports').send({ targetKind: 'COMMENT', targetId: tip.id, reason: 'SPAM' }).expect(409);
    const report = await e2e.as(carla.token).post('/me/reports').send({ targetKind: 'COMMENT', targetId: tip.id, reason: 'INFORMACION_ENGANOSA' }).expect(201);
    expect(report.body.data.contentHidden).toBe(false);

    await e2e.sql(`INSERT INTO public.tenants (id, nombre) VALUES ('e2e-otro-gym', 'Otro gimnasio') ON CONFLICT (id) DO NOTHING`);
    await e2e.sql(`UPDATE public.usuarios SET tenant_id = 'e2e-otro-gym' WHERE id = :id`, { id: dani.id });
    const other = (await list(dani)).items.find((c) => c.id === tip.id);
    expect(other).toBeDefined();
    await e2e.as(dani.token).post('/me/reports').send({ targetKind: 'COMMENT', targetId: tip.id, reason: 'SPAM' }).expect(201);
  });

  it('tres denunciantes distintos lo ocultan para todos', async () => {
    const victim = await e2e.as(beto.token).post(`/comments/EXERCISE/${exerciseId}`).send({ texto: 'Comentario molesto' }).expect(201);
    const id = victim.body.data.id as string;
    const extra = await e2e.register('exc-eva');
    for (const who of [carla, dani, extra]) {
      await e2e.as(who.token).post('/me/reports').send({ targetKind: 'COMMENT', targetId: id, reason: 'ACOSO' }).expect(201);
    }
    expect((await list(carla)).items.some((c) => c.id === id)).toBe(false);
  });
});
