import request from 'supertest';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { grantConsent } from './support/privacy-e2e';

type Body = { data: Record<string, unknown> & { about?: Record<string, unknown> } };

describe('Conocer: perfil social, readiness y paso de onboarding (e2e)', () => {
  let e2e: E2eApp;
  const tag = `sp-${Date.now()}`;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
  });

  it('requires authentication', async () => {
    await request(e2e.http).get(e2e.url('/me/social-profile')).expect(401);
    await request(e2e.http).get(e2e.url('/social/catalog/interests')).expect(401);
    await request(e2e.http).get(e2e.url('/me/discovery/readiness')).expect(401);
    await request(e2e.http).put(e2e.url('/me/onboarding/social')).send({ action: 'SKIP' }).expect(401);
  });

  it('serves the closed interests catalog', async () => {
    const { token } = await e2e.register(`${tag}-catalog`);
    const response = await e2e.as(token).get('/social/catalog/interests').expect(200);
    expect(response.body.data).toEqual(expect.arrayContaining([{ code: 'RUNNING', label: 'Correr' }]));
  });

  it('creates and updates the profile with optimistic versioning', async () => {
    const { token } = await e2e.register(`${tag}-crud`);
    const api = e2e.as(token);
    const initial = await api.get('/me/social-profile').expect(200);
    expect(initial.body.data).toMatchObject({ configured: false, version: 0, orientationVisible: false });

    const created = await api
      .put('/me/social-profile')
      .send({ interests: ['YOGA', 'MUSIC'], drinking: 'NEVER', bio: '  Hola, entreno de noche.  ', expectedVersion: 0 })
      .expect(200);
    expect(created.body.data).toEqual({
      configured: true,
      orientation: null,
      orientationVisible: false,
      interests: ['YOGA', 'MUSIC'],
      drinking: 'NEVER',
      smoking: null,
      pets: null,
      bio: 'Hola, entreno de noche.',
      version: 1,
    });

    const update = { interests: ['RUNNING'], pets: 'DOG', expectedVersion: 1 };
    const race = await Promise.all([
      api.put('/me/social-profile').send(update),
      api.put('/me/social-profile').send(update),
    ]);
    expect(race.map((response) => response.status).sort()).toEqual([200, 409]);
    await api.put('/me/social-profile').send({ expectedVersion: 0 }).expect(409);
    await api.put('/me/social-profile').send({ ...update, expectedVersion: 9 }).expect(409);

    const withUrl = await api.put('/me/social-profile').send({ bio: 'mira www.mi-sitio.com', expectedVersion: 2 }).expect(400);
    expect(JSON.stringify(withUrl.body)).toContain('Tu bio no puede incluir enlaces');
    const withPhone = await api.put('/me/social-profile').send({ bio: 'wsp 70012345', expectedVersion: 2 }).expect(400);
    expect(JSON.stringify(withPhone.body)).toContain('Tu bio no puede incluir números de teléfono');
    await api
      .put('/me/social-profile')
      .send({ interests: ['YOGA', 'MUSIC', 'ART', 'RUNNING', 'DANCE', 'TRAVEL'], expectedVersion: 2 })
      .expect(400);
    await api.put('/me/social-profile').send({ interests: ['KNITTING'], expectedVersion: 2 }).expect(400);

    const persisted = await api.get('/me/social-profile').expect(200);
    expect(persisted.body.data).toMatchObject({ interests: ['RUNNING'], pets: 'DOG', bio: null, version: 2 });
  });

  it('reports each missing discovery requirement until the account is ready', async () => {
    const { token, id } = await e2e.register(`${tag}-ready`);
    const api = e2e.as(token);
    const readiness = async () => (await api.get('/me/discovery/readiness').expect(200)).body as Body;

    expect((await readiness()).data).toEqual({ ready: false, missing: ['PROFILE_ENABLED', 'PREFERENCES', 'PHOTOS'] });

    await api
      .patch('/me/social-discovery-settings')
      .send({ profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0 })
      .expect(200);
    expect((await readiness()).data).toEqual({ ready: false, missing: ['PREFERENCES', 'PHOTOS'] });

    await api
      .put('/me/discovery/preferences')
      .send({ genders: ['MALE', 'FEMALE'], intents: ['UNSURE'], minAge: 18, maxAge: 60, radiusKm: 30, flexibleAge: true, flexibleDistance: true, expectedVersion: 0 })
      .expect(200);
    await api
      .put('/me/discovery/preferences')
      .send({ genders: ['FEMALE'], intents: ['UNSURE', 'DATING'], minAge: 18, maxAge: 60, radiusKm: 30, flexibleAge: true, flexibleDistance: true, expectedVersion: 1 })
      .expect(400);
    const preferences = await api.get('/me/discovery/preferences').expect(200);
    expect(preferences.body.data).toMatchObject({ intents: ['UNSURE'], version: 1 });
    expect((await readiness()).data).toEqual({ ready: false, missing: ['PHOTOS'] });

    const insertPhoto = (key: string, position: number) =>
      e2e.sql(
        `INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key, position, created_at)
         VALUES (gen_random_uuid(), :id, 'https://media.e2e.test/p.jpg', 'minio', :key, :position, now())`,
        { id, key, position },
      );
    await insertPhoto(`${tag}-p1`, 0);
    await insertPhoto(`${tag}-hidden`, 1);
    await e2e.sql(`UPDATE profile.photos SET hidden_at = now() WHERE storage_key = :key`, { key: `${tag}-hidden` });
    expect((await readiness()).data).toEqual({ ready: false, missing: ['PHOTOS'] });

    await insertPhoto(`${tag}-p2`, 2);
    expect((await readiness()).data).toEqual({ ready: true, missing: [] });
  });

  it('lets the social onboarding step be skipped and resumed without blocking completion', async () => {
    const { token } = await e2e.register(`${tag}-onb`);
    const api = e2e.as(token);
    expect((await api.get('/me/onboarding').expect(200)).body.data.socialStep).toBe('PENDING');
    await api.put('/me/onboarding/social').send({ action: 'LATER' }).expect(400);

    const skipped = await api.put('/me/onboarding/social').send({ action: 'SKIP' }).expect(200);
    expect(skipped.body.data.socialStep).toBe('SKIPPED');

    await api.put('/me/onboarding/profile').send({ weight: 70, weightUnit: 'KG', height: 170, heightUnit: 'CM', measuredOn: '2026-10-10' }).expect(200);
    await api.put('/me/onboarding/goals').send({ primaryGoal: 'GAIN_MUSCLE' }).expect(200);
    await api
      .put('/me/onboarding/preferences')
      .send({ experienceLevel: 'BEGINNER', weeklyFrequency: 3, trainingLocation: 'GYM', trainingPreferences: [], consentHealth: true, consentData: true })
      .expect(200);
    await api.put('/me/onboarding/equipment').send({ availableEquipment: [] }).expect(200);
    const completed = await api.post('/me/onboarding/complete').expect(201);
    expect(completed.body.data).toMatchObject({ status: 'COMPLETED', socialStep: 'SKIPPED' });

    const resumed = await api.put('/me/onboarding/social').send({ action: 'DONE' }).expect(200);
    expect(resumed.body.data).toMatchObject({ status: 'COMPLETED', socialStep: 'DONE' });
    const lateSkip = await api.put('/me/onboarding/social').send({ action: 'SKIP' }).expect(200);
    expect(lateSkip.body.data.socialStep).toBe('DONE');
  });

  it('never shows a hidden orientation to another member', async () => {
    const owner = await e2e.register(`${tag}-owner`);
    const viewer = await e2e.register(`${tag}-viewer`);
    const ownerApi = e2e.as(owner.token);
    const viewerApi = e2e.as(viewer.token);
    // Storing an orientation needs the separate ORIENTATION consent (ADR-0014).
    await grantConsent(e2e, owner.token, 'ORIENTATION');
    await ownerApi
      .put('/me/social-profile')
      .send({ orientation: 'GAY', interests: ['CLIMBING'], smoking: 'NEVER', bio: 'Escalo los sábados.', expectedVersion: 0 })
      .expect(200);

    const hidden = (await viewerApi.get(`/me/gym-directory/${owner.id}`).expect(200)).body as Body;
    expect(hidden.data.about).toEqual({ interests: ['CLIMBING'], drinking: null, smoking: 'NEVER', pets: null, bio: 'Escalo los sábados.' });
    expect(JSON.stringify(hidden)).not.toContain('GAY');
    const listed = await viewerApi.get(`/me/gym-directory?q=${encodeURIComponent(`E2E ${tag}-owner`)}`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain('GAY');

    // The owner still sees their own hidden answer.
    expect((await ownerApi.get('/me/social-profile').expect(200)).body.data).toMatchObject({ orientation: 'GAY', orientationVisible: false });

    await ownerApi
      .put('/me/social-profile')
      .send({ orientation: 'GAY', orientationVisible: true, interests: ['CLIMBING'], expectedVersion: 1 })
      .expect(200);
    const visible = (await viewerApi.get(`/me/gym-directory/${owner.id}`).expect(200)).body as Body;
    expect(visible.data.about).toMatchObject({ orientation: 'GAY', interests: ['CLIMBING'] });
  });
});
