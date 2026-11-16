import request from 'supertest';
import { CONSENT_VERSIONS } from '../src/modules/legal/consent-versions';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { grantConsent, selectRows } from './support/privacy-e2e';

/**
 * Consent ledger (ADR-0014): separate, versioned and revocable consents;
 * revoking erases the datum; sensitive writes need an open consent.
 */
describe('Consent ledger (e2e)', () => {
  let e2e: E2eApp;
  const locationBody = { latitude: -16.5, longitude: -68.15 };
  const enableMap = (token: string, expectedVersion: number, mapEnabled = true) =>
    e2e.as(token).patch('/me/social-discovery-settings')
      .send({ profileEnabled: true, crossGymEnabled: false, mapEnabled, expectedVersion });
  const consentRows = (userId: string, kind: string) =>
    selectRows<{ version: string; channel: string; revoked: boolean }>(
      e2e,
      `SELECT version, channel, revoked_at IS NOT NULL AS revoked FROM auth.consents
        WHERE user_id = :userId AND kind = :kind ORDER BY granted_at, id`,
      { userId, kind },
    );
  const preferences = {
    experienceLevel: 'BEGINNER',
    weeklyFrequency: 3,
    trainingLocation: 'GYM',
    trainingPreferences: [],
    consentData: true,
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
  });

  it('requires a session and validates kind and version', async () => {
    await request(e2e.http).get(e2e.url('/me/consents')).expect(401);
    const { token } = await e2e.register('consent-validation');
    const api = e2e.as(token);
    await api.put('/me/consents/DNA').send({ granted: true, version: 'x' }).expect(400);
    await api.put('/me/consents/HEALTH').send({ granted: true }).expect(400);
    const outdated = await api.put('/me/consents/HEALTH').send({ granted: true, version: '2000-01-01' }).expect(409);
    expect(outdated.body.code).toBe('CONSENT_VERSION_OUTDATED');
  });

  it('lists every consent, records version and channel, and keeps each account isolated', async () => {
    const a = await e2e.register('consent-list-a');
    const b = await e2e.register('consent-list-b');
    const initial = await e2e.as(a.token).get('/me/consents').expect(200);
    expect(initial.body.data.consents).toHaveLength(4);
    expect(initial.body.data.consents.every((consent: { granted: boolean }) => !consent.granted)).toBe(true);

    const granted = await e2e.as(a.token).put('/me/consents/VERIFICATION_SELFIE').set('X-Client-Platform', 'android')
      .send({ granted: true, version: CONSENT_VERSIONS.VERIFICATION_SELFIE }).expect(200);
    expect(granted.body.data).toMatchObject({ kind: 'VERIFICATION_SELFIE', granted: true, upToDate: true });
    // Idempotent: the same grant again adds no row.
    await grantConsent(e2e, a.token, 'VERIFICATION_SELFIE');
    expect(await consentRows(a.id, 'VERIFICATION_SELFIE')).toEqual([
      { version: CONSENT_VERSIONS.VERIFICATION_SELFIE, channel: 'ANDROID', revoked: false },
    ]);

    const other = await e2e.as(b.token).get('/me/consents').expect(200);
    expect(other.body.data.consents.find((consent: { kind: string }) => consent.kind === 'VERIFICATION_SELFIE'))
      .toMatchObject({ granted: false });

    const revoked = await e2e.as(a.token).put('/me/consents/VERIFICATION_SELFIE').send({ granted: false }).expect(200);
    expect(revoked.body.data).toMatchObject({ granted: false, revokedAt: expect.any(String) });
  });

  it('completes onboarding without the health consent', async () => {
    const { token, id } = await e2e.register('consent-onboarding');
    const api = e2e.as(token);
    await api.put('/me/onboarding/profile').send({ weight: 70, weightUnit: 'KG', height: 170, heightUnit: 'CM', measuredOn: '2026-10-10' }).expect(200);
    await api.put('/me/onboarding/goals').send({ primaryGoal: 'GAIN_MUSCLE' }).expect(200);
    await api.put('/me/onboarding/preferences').send({ ...preferences, consentHealth: false }).expect(200);
    await api.put('/me/onboarding/equipment').send({ availableEquipment: [] }).expect(200);
    const done = await api.post('/me/onboarding/complete').expect(201);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', consentHealth: false, missingFields: [] });
    expect(await consentRows(id, 'HEALTH')).toEqual([]);
  });

  it('keeps physical considerations only with the HEALTH consent and erases them on revocation', async () => {
    const { token, id } = await e2e.register('consent-health');
    const api = e2e.as(token);
    const refused = await api.put('/me/onboarding/preferences')
      .send({ ...preferences, physicalConsiderations: 'Lesión de rodilla', consentHealth: false }).expect(400);
    expect(refused.body.code).toBe('CONSENT_REQUIRED');

    await api.put('/me/onboarding/preferences').set('X-Client-Platform', 'ios')
      .send({ ...preferences, physicalConsiderations: 'Lesión de rodilla', consentHealth: true, consentHealthVersion: CONSENT_VERSIONS.HEALTH })
      .expect(200);
    expect(await consentRows(id, 'HEALTH')).toEqual([{ version: CONSENT_VERSIONS.HEALTH, channel: 'IOS', revoked: false }]);

    await api.put('/me/consents/HEALTH').send({ granted: false }).expect(200);
    const [onboarding] = await selectRows<{ text: string | null; consent: boolean }>(
      e2e,
      'SELECT physical_considerations AS text, consent_health AS consent FROM profile.onboarding WHERE user_id = :id',
      { id },
    );
    expect(onboarding).toEqual({ text: null, consent: false });
    expect((await api.get('/me/onboarding').expect(200)).body.data.physicalConsiderations).toBeNull();
  });

  it('blocks an orientation without ORIENTATION consent and erases it (and its visibility) on revocation', async () => {
    const { token, id } = await e2e.register('consent-orientation');
    const api = e2e.as(token);
    const profile = { orientation: 'BISEXUAL', orientationVisible: true, expectedVersion: 0 };
    const blocked = await api.put('/me/social-profile').send(profile).expect(400);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');
    // Without an orientation nothing sensitive is stored, so no consent is needed.
    await api.put('/me/social-profile').send({ orientation: null, expectedVersion: 0 }).expect(200);

    await grantConsent(e2e, token, 'ORIENTATION');
    await api.put('/me/social-profile').send({ ...profile, expectedVersion: 1 }).expect(200);
    await api.put('/me/consents/ORIENTATION').send({ granted: false }).expect(200);

    const mine = await api.get('/me/social-profile').expect(200);
    expect(mine.body.data).toMatchObject({ orientation: null, orientationVisible: false });
    const [row] = await selectRows<{ orientation: string | null }>(
      e2e,
      'SELECT orientation FROM social.profile_details WHERE user_id = :id',
      { id },
    );
    expect(row.orientation).toBeNull();
  });

  it('blocks map sharing without PRECISE_LOCATION and deletes the location (map off) on revocation', async () => {
    const { token, id } = await e2e.register('consent-location');
    const api = e2e.as(token);
    await enableMap(token, 0).expect(200);
    const blocked = await api.patch('/me/social-map/location').send(locationBody).expect(400);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');

    await grantConsent(e2e, token, 'PRECISE_LOCATION');
    await api.patch('/me/social-map/location').send(locationBody).expect(200);
    await api.put('/me/consents/PRECISE_LOCATION').send({ granted: false }).expect(200);

    expect(await selectRows(e2e, 'SELECT 1 FROM social.map_locations WHERE user_id = :id', { id })).toEqual([]);
    const settings = await api.get('/me/social-discovery-settings').expect(200);
    expect(settings.body.data.mapEnabled).toBe(false);
  });

  it('turning the map off deletes the stored precise location', async () => {
    const { token, id } = await e2e.register('map-off');
    const api = e2e.as(token);
    await enableMap(token, 0).expect(200);
    await grantConsent(e2e, token, 'PRECISE_LOCATION');
    await api.patch('/me/social-map/location').send(locationBody).expect(200);
    expect(await selectRows(e2e, 'SELECT 1 FROM social.map_locations WHERE user_id = :id', { id })).toHaveLength(1);

    await enableMap(token, 1, false).expect(200);
    expect(await selectRows(e2e, 'SELECT 1 FROM social.map_locations WHERE user_id = :id', { id })).toEqual([]);
  });
});
