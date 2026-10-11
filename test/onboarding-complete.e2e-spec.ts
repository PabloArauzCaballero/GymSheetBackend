import { bootE2eApp, E2eApp } from './support/e2e-app';

/**
 * Regresión: con un usuario nuevo, PUT profile creaba la fila de onboarding dentro
 * de una transacción y actualizaba fuera de ella, así que la altura y el paso 2 se
 * perdían y POST complete respondía 422 con todos los pasos guardados.
 */
describe('Onboarding: flujo completo (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
  });

  const profile = {
    weight: 75,
    weightUnit: 'KG',
    height: 175,
    heightUnit: 'CM',
    measuredOn: '2026-10-10',
  };
  const goals = { primaryGoal: 'GAIN_MUSCLE' };
  const preferences = {
    experienceLevel: 'INTERMEDIATE',
    weeklyFrequency: 4,
    trainingLocation: 'GYM',
    trainingPreferences: [],
    consentHealth: true,
    consentData: true,
  };

  it('completa el onboarding de un usuario nuevo con equipo y preferencias vacíos', async () => {
    const { token } = await e2e.register('onb-complete');
    const api = e2e.as(token);

    const saved = await api.put('/me/onboarding/profile').send(profile).expect(200);
    expect(saved.body.data.height).toBe(175);
    expect(saved.body.data.completedSteps).toContain(2);
    await api.put('/me/onboarding/goals').send(goals).expect(200);
    await api.put('/me/onboarding/preferences').send(preferences).expect(200);
    await api.put('/me/onboarding/equipment').send({ availableEquipment: [] }).expect(200);

    const done = await api.post('/me/onboarding/complete').expect(201);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.profileComplete).toBe(true);
    expect(done.body.data.missingFields).toEqual([]);
  });

  it('responde 422 con code estable y los campos pendientes en español', async () => {
    const { token } = await e2e.register('onb-incomplete');
    const api = e2e.as(token);
    await api.put('/me/onboarding/goals').send(goals).expect(200);

    const res = await api.post('/me/onboarding/complete').expect(422);
    expect(res.body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(res.body.detail).toBe('Faltan datos obligatorios para completar el onboarding.');
    expect(res.body.details.missingFields).toEqual(
      expect.arrayContaining(['weight', 'height', 'experienceLevel', 'consentHealth']),
    );
  });
});
