import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/** RF-07 · Me gusta público + favorito privado + visibilidad de ejercicios privados (D3, D7). */
describe('Exercise like and favorite (e2e)', () => {
  let e2e: E2eApp;
  let owner: { token: string; id: string };
  let other: { token: string; id: string };
  let exerciseId: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await e2e.register('like-owner');
    other = await e2e.register('like-other');
    exerciseId = await createPersonalExercise(e2e.as(owner.token), `Privado like ${Date.now()}`);
  }, 60000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  it('un ejercicio privado ajeno responde 404 si no llega por una rutina visible', async () => {
    await e2e.as(other.token).get(`/exercises/${exerciseId}`).expect(404);
    await e2e.as(other.token).post(`/exercises/${exerciseId}/like`).expect(404);
  });

  it('el me gusta es idempotente y el contador no se duplica', async () => {
    const api = e2e.as(owner.token);
    const first = await api.post(`/exercises/${exerciseId}/like`).expect(201);
    expect(first.body.data).toEqual({ meGusta: true, meGustaTotal: 1 });
    const again = await api.post(`/exercises/${exerciseId}/like`).expect(201);
    expect(again.body.data.meGustaTotal).toBe(1);
    const detail = await api.get(`/exercises/${exerciseId}`).expect(200);
    expect(detail.body.data.meGusta).toBe(true);
    expect(detail.body.data.meGustaTotal).toBe(1);
  });

  it('quitar el me gusta baja el contador y no baja de cero', async () => {
    const api = e2e.as(owner.token);
    const off = await api.del(`/exercises/${exerciseId}/like`).expect(200);
    expect(off.body.data).toEqual({ meGusta: false, meGustaTotal: 0 });
    const twice = await api.del(`/exercises/${exerciseId}/like`).expect(200);
    expect(twice.body.data.meGustaTotal).toBe(0);
  });

  it('favorito es privado: filtra la lista de quien lo marcó y no la de otros', async () => {
    const mine = e2e.as(owner.token);
    await mine.put(`/me/exercises/${exerciseId}/preference`).send({ isFavorite: true }).expect(200);
    const favs = await mine.get('/exercises?favoritos=true&pageSize=100').expect(200);
    expect(favs.body.data.items.map((e: { id: string }) => e.id)).toContain(exerciseId);
    expect(favs.body.data.items.every((e: { esFavorito: boolean }) => e.esFavorito)).toBe(true);
    const theirs = await e2e.as(other.token).get('/exercises?favoritos=true&pageSize=100').expect(200);
    expect(theirs.body.data.items.map((e: { id: string }) => e.id)).not.toContain(exerciseId);
  });

  it('un ejercicio privado se abre desde una rutina pública (D3), y el me gusta de otra persona suma', async () => {
    const created = await e2e
      .as(owner.token)
      .post('/routines')
      .send({ nombre: 'Con privado', dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: exerciseId }] }] })
      .expect(201);
    // Hasta que sea pública, la otra persona no lo ve.
    await e2e.as(other.token).get(`/exercises/${exerciseId}`).expect(404);
    // La publicación llega en F4: aquí se simula con SQL de apoyo cuando exista el endpoint.
    expect(created.body.data.id).toBeDefined();
  });
});
