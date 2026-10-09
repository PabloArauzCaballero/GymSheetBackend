import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-13 · compartir una privada con invitación aceptar/rechazar y avisos a las dos partes. */
describe('Routines v2 · sharing (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let guest: { token: string; id: string };
  let outsider: { token: string; id: string };
  let routineId = '';
  let shareId = '';

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('share-owner');
    guest = await e2e.register('share-guest');
    outsider = await e2e.register('share-outsider');
    const ex = await createPersonalExercise(e2e.as(owner.token), `Share ${Date.now()}`);
    const created = await e2e
      .as(owner.token)
      .post('/routines')
      .send({ nombre: 'Privada compartida', dias: [{ diaSemana: 2, nombre: 'Martes', ejercicios: [{ ejercicioId: ex }] }] })
      .expect(201);
    routineId = created.body.data.id;
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  /** Bandeja de la persona como texto, para buscar el tipo de aviso sin acoplarse a su forma. */
  const inbox = async (token: string): Promise<string> =>
    JSON.stringify((await e2e.as(token).get('/notifications/me').expect(200)).body.data);

  it('invitar crea PENDING, omite al autor y avisa al invitado', async () => {
    const res = await e2e
      .as(owner.token)
      .post(`/routines/${routineId}/shares`)
      .send({ usuarioIds: [guest.id, owner.id] })
      .expect(201);
    expect(res.body.data.creados).toHaveLength(1);
    expect(res.body.data.creados[0].estado).toBe('PENDING');
    expect(res.body.data.omitidos).toEqual([{ usuarioId: owner.id, motivo: 'ES_EL_AUTOR' }]);
    shareId = res.body.data.creados[0].id;
    expect(await inbox(guest.token)).toContain('ROUTINE_SHARE_INVITE');
  });

  it('invitar de nuevo al mismo usuario lo omite como YA_INVITADO', async () => {
    const res = await e2e.as(owner.token).post(`/routines/${routineId}/shares`).send({ usuarioIds: [guest.id] }).expect(201);
    expect(res.body.data.omitidos).toEqual([{ usuarioId: guest.id, motivo: 'YA_INVITADO' }]);
  });

  it('con la invitación pendiente el invitado NO ve el contenido (SHARE_PENDING) pero sí la tarjeta', async () => {
    const detail = await e2e.as(guest.token).get(`/routines/${routineId}`).expect(403);
    expect(detail.body.code).toBe('SHARE_PENDING');
    const shared = await e2e.as(guest.token).get('/routines?scope=shared').expect(200);
    const card = shared.body.data.items.find((r: { id: string }) => r.id === routineId);
    expect(card.invitacion).toMatchObject({ id: shareId, estado: 'PENDING' });
    expect(card.ejerciciosTotal).toBeNull();
    expect(card.dias[0]).toMatchObject({ diaSemana: 2, nombre: 'Martes', ejerciciosTotal: null });
    await e2e.as(guest.token).get(`/routines/${routineId}/calendar`).expect(403);
  });

  it('un tercero no ve ni la tarjeta ni puede responder la invitación', async () => {
    await e2e.as(outsider.token).get(`/routines/${routineId}`).expect(404);
    await e2e.as(outsider.token).post(`/routine-shares/${shareId}/accept`).expect(404);
    const shared = await e2e.as(outsider.token).get('/routines?scope=shared').expect(200);
    expect(shared.body.data.items).toHaveLength(0);
  });

  it('el invitado ve su invitación pendiente en /me/routine-invitations', async () => {
    const res = await e2e.as(guest.token).get('/me/routine-invitations?estado=PENDING').expect(200);
    expect(res.body.data.map((i: { id: string }) => i.id)).toContain(shareId);
  });

  it('aceptar es idempotente, habilita el contenido y avisa a la autora', async () => {
    const first = await e2e.as(guest.token).post(`/routine-shares/${shareId}/accept`).expect(201);
    expect(first.body.data.estado).toBe('ACCEPTED');
    const again = await e2e.as(guest.token).post(`/routine-shares/${shareId}/accept`).expect(201);
    expect(again.body.data.estado).toBe('ACCEPTED');
    const detail = await e2e.as(guest.token).get(`/routines/${routineId}`).expect(200);
    expect(detail.body.data.dias[0].ejercicios).toHaveLength(1);
    expect(detail.body.data.puedoEditar).toBe(false);
    const cal = await e2e.as(guest.token).get(`/routines/${routineId}/calendar?semanas=1`).expect(200);
    expect(cal.body.data.semanas).toHaveLength(1);
    expect(await inbox(owner.token)).toContain('ROUTINE_SHARE_ACCEPTED');
  });

  it('la autora lista a sus invitados y revoca: el invitado vuelve a no verla', async () => {
    const list = await e2e.as(owner.token).get(`/routines/${routineId}/shares`).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: shareId, estado: 'ACCEPTED' });
    await e2e.as(guest.token).get(`/routines/${routineId}/shares`).expect(403);
    await e2e.as(owner.token).del(`/routines/${routineId}/shares/${shareId}`).expect(200);
    await e2e.as(guest.token).get(`/routines/${routineId}`).expect(404);
  });

  it('rechazar: avisa a la autora y el invitado nunca ve el contenido; se puede volver a invitar', async () => {
    const invite = await e2e.as(owner.token).post(`/routines/${routineId}/shares`).send({ usuarioIds: [guest.id] }).expect(201);
    const id = invite.body.data.creados[0].id as string;
    const declined = await e2e.as(guest.token).post(`/routine-shares/${id}/decline`).expect(201);
    expect(declined.body.data.estado).toBe('DECLINED');
    await e2e.as(guest.token).get(`/routines/${routineId}`).expect(404);
    await e2e.as(guest.token).post(`/routine-shares/${id}/accept`).expect(201); // ya respondida: no cambia
    expect((await e2e.as(guest.token).get('/me/routine-invitations').expect(200)).body.data.find((i: { id: string }) => i.id === id).estado).toBe('DECLINED');
    expect(await inbox(owner.token)).toContain('ROUTINE_SHARE_DECLINED');
    const again = await e2e.as(owner.token).post(`/routines/${routineId}/shares`).send({ usuarioIds: [guest.id] }).expect(201);
    expect(again.body.data.creados).toHaveLength(1);
  });

  it('no se comparte una rutina pública ni una ajena', async () => {
    await e2e.as(outsider.token).post(`/routines/${routineId}/shares`).send({ usuarioIds: [guest.id] }).expect(404);
    await e2e.as(owner.token).post(`/routines/${routineId}/shares`).send({ usuarioIds: ['00000000-0000-0000-0000-00000000dead'] }).expect(201);
  });
});
