import { randomUUID } from 'node:crypto';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';
import { Member, registerModerator } from './support/moderation-e2e';

/**
 * ADR-0018 §9: the central moderator reads the reported content in the case
 * file. Since franja 7a (ADR-0019 §4) it cannot open the author's routes, so a
 * private routine or exercise of another gym is only visible through the
 * snapshot, hidden or not; gym staff stays refused and an erased target says so.
 */
describe('Moderation case content (e2e)', () => {
  let e2e: E2eApp;
  let gymB: string;
  let author: Member;
  let reporter: Member;
  let moderator: Member;
  let exerciseId: string;
  let routineId: string;
  let commentId: string;
  const exerciseName = `Remo peligroso ${randomUUID().slice(0, 6)}`;

  const caseOf = (member: Member, kind: string, id: string, status = 200) =>
    e2e.as(member.token).get(`/admin/moderation/cases/${kind}/${id}`).expect(status);

  beforeAll(async () => {
    e2e = await bootE2eApp();
    gymB = `case-content-${randomUUID().slice(0, 8)}`;
    await e2e.sql('INSERT INTO public.tenants (id, nombre) VALUES (:gymB, :name)', { gymB, name: 'Gimnasio B' });
    author = await e2e.register('case-content-author');
    reporter = await e2e.register('case-content-reporter');
    const copier = await e2e.register('case-content-copier');
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :gymB WHERE id IN (:ids)', { gymB, ids: [author.id, reporter.id, copier.id] });
    moderator = await registerModerator(e2e, 'case-content-moderator');

    exerciseId = await createPersonalExercise(e2e.as(author.token), exerciseName);
    const created = await e2e.as(author.token).post('/routines').send({
      nombre: `Rutina denunciada ${randomUUID().slice(0, 6)}`,
      descripcion: 'Dos días de prueba',
      dias: [
        { diaSemana: 1, nombre: 'Empuje', ejercicios: [{ ejercicioId: exerciseId, seriesObjetivo: 4, repsMin: 8, repsMax: 10 }] },
        { diaSemana: 4, nombre: 'Tirón', ejercicios: [{ ejercicioId: exerciseId, seriesObjetivo: 3 }] },
      ],
    }).expect(201);
    routineId = created.body.data.id as string;
    await e2e.as(author.token).post(`/routines/${routineId}/publish`).expect(201);
    await e2e.as(copier.token).post(`/routines/${routineId}/copy`).expect(201);
    const comment = await e2e.as(reporter.token).post(`/comments/ROUTINE/${routineId}`).send({ texto: 'Comentario a borrar' }).expect(201);
    commentId = comment.body.data.id as string;
    for (const [targetKind, targetId] of [['ROUTINE', routineId], ['EXERCISE', exerciseId]]) {
      await e2e.as(reporter.token).post('/me/reports').send({ targetKind, targetId, reason: 'EJERCICIO_PELIGROSO' }).expect(201);
    }
    await e2e.as(author.token).post('/me/reports').send({ targetKind: 'COMMENT', targetId: commentId, reason: 'ACOSO' }).expect(201);
    // After the report the author takes the routine private: nobody else can open it any more.
    await e2e.sql(`UPDATE training.routines SET visibilidad = 'PRIVATE' WHERE id = :routineId`, { routineId });
  }, 90000);
  afterAll(async () => e2e?.app.close());

  it('a moderator reads the private routine of another gym in the case file, with days, sets and reach', async () => {
    // The author's route stays closed to the moderator (ADR-0019 §4): the case file is the door.
    await e2e.as(moderator.token).get(`/routines/${routineId}`).expect(404);
    const kase = await caseOf(moderator, 'ROUTINE', routineId);
    expect(kase.body.data).toMatchObject({ tenantId: gymB, contentUnavailableReason: null, evidence: null });
    expect(kase.body.data.content).toEqual({
      kind: 'ROUTINE',
      name: expect.stringContaining('Rutina denunciada') as unknown,
      description: 'Dos días de prueba',
      visibility: 'PRIVATE',
      days: [
        { name: 'Empuje', weekday: 1, exercises: [{ name: exerciseName, sets: 4, repsMin: 8, repsMax: 10, weightKg: null, durationSeconds: null }] },
        { name: 'Tirón', weekday: 4, exercises: [expect.objectContaining({ name: exerciseName, sets: 3 }) as unknown] },
      ],
      reach: { copies: 1, liveCopies: 1, activations: 0 },
    });
  });

  it('the snapshot stays while the content is hidden by moderation', async () => {
    await e2e.sql(`UPDATE public.ejercicios SET estado_moderacion = 'OCULTO_MODERACION' WHERE id = :exerciseId`, { exerciseId });
    const kase = await caseOf(moderator, 'EXERCISE', exerciseId);
    expect(kase.body.data).toMatchObject({ contentHidden: true, tenantId: gymB });
    expect(kase.body.data.content).toMatchObject({ kind: 'EXERCISE', name: exerciseName, media: [] });
    expect((kase.body.data.content as { muscleGroups: string[] }).muscleGroups.length).toBeGreaterThan(0);
  });

  it('gym staff is refused the case file, content included', async () => {
    const gymAdmin = await e2e.register('case-content-gym-admin');
    await e2e.promote(gymAdmin.id, 'ADMIN');
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :gymB WHERE id = :id', { gymB, id: gymAdmin.id });
    const refused = await caseOf(gymAdmin, 'ROUTINE', routineId, 403);
    expect(refused.body.data?.content).toBeUndefined();
  });

  it('an erased target answers content null with the reason', async () => {
    const before = await caseOf(moderator, 'COMMENT', commentId);
    expect(before.body.data.content).toEqual({
      kind: 'COMMENT', text: 'Comentario a borrar', attachmentUrl: null, attachmentType: null, deletedByAuthor: false,
    });
    // The reported-content retention deletes a comment without replies once its reports are old.
    await e2e.sql('DELETE FROM community.content_comments WHERE id = :commentId', { commentId });
    const after = await caseOf(moderator, 'COMMENT', commentId);
    expect(after.body.data).toMatchObject({ content: null, contentUnavailableReason: 'ERASED' });
  });
});
