import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { CONSENT_KINDS, CONSENT_VERSIONS } from '../src/modules/legal/consent-versions';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_CONTENT_SHA256 } from '../src/modules/legal/legal-documents';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';

/**
 * Signup demands sex, an adult birth date and the current terms version, and
 * leaves an auditable acceptance per document. A version bump blocks every
 * authenticated route with 428 until the person accepts the new version.
 */
describe('Legal acceptance and signup requirements (e2e)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const body = (label: string, overrides: Record<string, unknown> = {}) => ({
    email: `legal-${label}-${stamp}@example.test`,
    password: 'e2e-strong-password',
    nombreCompleto: `Legal ${label}`,
    ...E2E_SIGNUP_FIELDS,
    ...overrides,
  });
  const register = (payload: Record<string, unknown>) =>
    request(e2e.http).post(e2e.url('/auth/register')).send(payload);
  const select = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
    sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });

  /** 17 years and 364 days old today (UTC), i.e. turns 18 tomorrow. */
  function turnsEighteenTomorrow(): string {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCFullYear(tomorrow.getUTCFullYear() - 18);
    return tomorrow.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
  });
  afterEach(() => jest.restoreAllMocks());

  it('publishes the current documents without authentication, cacheably', async () => {
    const response = await request(e2e.http).get(e2e.url('/legal/current')).expect(200);
    expect(response.body.data).toEqual({
      documents: [
        { document: 'TERMS', version: LEGAL_DOCUMENTS.TERMS, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.TERMS },
        { document: 'PRIVACY', version: LEGAL_DOCUMENTS.PRIVACY, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.PRIVACY },
        { document: 'COMMUNITY', version: LEGAL_DOCUMENTS.COMMUNITY, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.COMMUNITY },
      ],
      consents: CONSENT_KINDS.map((kind) => ({ kind, version: CONSENT_VERSIONS[kind] })),
    });
    expect(response.headers['cache-control']).toContain('public');
  });

  it.each([
    ['missing birth date', { fechaNacimiento: undefined }, 'fechaNacimiento'],
    ['17 years and 364 days old', { fechaNacimiento: turnsEighteenTomorrow() }, 'fechaNacimiento'],
    ['missing sex', { genero: undefined }, 'genero'],
    ['non-binary sex value', { genero: 'UNSPECIFIED' }, 'genero'],
    ['missing terms version', { termsVersion: undefined }, 'termsVersion'],
  ])('rejects a signup with %s (400)', async (_label, overrides, field) => {
    const response = await register(body('invalid', overrides)).expect(400);
    expect(response.body.issues.fieldErrors).toHaveProperty(field);
  });

  it('rejects an outdated terms version with 409 TERMS_VERSION_OUTDATED and creates nothing', async () => {
    const payload = body('outdated', { termsVersion: '2000-01-01' });
    const response = await register(payload).expect(409);
    expect(response.body.code).toBe('TERMS_VERSION_OUTDATED');
    const rows = await select<{ id: string }>('SELECT id FROM public.usuarios WHERE email = :email', {
      email: payload.email,
    });
    expect(rows).toEqual([]);
  });

  it('stores birth date, sex and one auditable acceptance per document on signup', async () => {
    const payload = body('ok', { fechaNacimiento: '1990-03-04', genero: 'FEMALE' });
    await register(payload).set('X-Client-Platform', 'ios').set('User-Agent', 'e2e-agent').expect(201);
    const [account] = await select<{ id: string; birth: string; genero: string; terms_version: string }>(
      `SELECT id, fecha_nacimiento::text AS birth, genero, terms_version FROM public.usuarios WHERE email = :email`,
      { email: payload.email },
    );
    expect(account).toMatchObject({ birth: '1990-03-04', genero: 'FEMALE', terms_version: LEGAL_DOCUMENTS.TERMS });
    const acceptances = await select<{ document: string; version: string; channel: string; user_agent: string }>(
      `SELECT document, version, channel, user_agent FROM auth.terms_acceptances
        WHERE user_id = :userId ORDER BY document`,
      { userId: account.id },
    );
    expect(acceptances).toEqual([
      { document: 'COMMUNITY', version: LEGAL_DOCUMENTS.COMMUNITY, channel: 'IOS', user_agent: 'e2e-agent' },
      { document: 'PRIVACY', version: LEGAL_DOCUMENTS.PRIVACY, channel: 'IOS', user_agent: 'e2e-agent' },
      { document: 'TERMS', version: LEGAL_DOCUMENTS.TERMS, channel: 'IOS', user_agent: 'e2e-agent' },
    ]);
  });

  it('serves the profile age from the account birth date and writes profile edits there', async () => {
    const { token, id } = await e2e.register('legal-profile');
    const api = e2e.as(token);
    const goal = { pesoKg: 70, estaturaCm: 175, objetivo: 'HIPERTROFIA' };
    const created = await api.post('/profile').send(goal).expect(201);
    expect(created.body.data.fechaNacimiento).toBe(E2E_SIGNUP_FIELDS.fechaNacimiento);
    expect(typeof created.body.data.edad).toBe('number');

    await api.patch('/profile').send({ ...goal, fechaNacimiento: '1980-06-01' }).expect(200);
    const [account] = await select<{ birth: string }>(
      'SELECT fecha_nacimiento::text AS birth FROM public.usuarios WHERE id = :id',
      { id },
    );
    expect(account.birth).toBe('1980-06-01');
    const read = await api.get('/profile').expect(200);
    expect(read.body.data.fechaNacimiento).toBe('1980-06-01');
  });

  it('requires a session for the personal legal endpoints', async () => {
    await request(e2e.http).get(e2e.url('/me/legal/pending')).expect(401);
    await request(e2e.http).post(e2e.url('/me/legal/accept')).send({ acceptances: [] }).expect(401);
  });

  it('blocks with 428 after a version bump and unblocks once the new version is accepted', async () => {
    const { token, id } = await e2e.register('legal-bump');
    const api = e2e.as(token);
    await api.get('/users/me').expect(200);
    await expect(api.get('/me/legal/pending').expect(200)).resolves.toMatchObject({ body: { data: { pending: [] } } });

    jest.replaceProperty(LEGAL_DOCUMENTS, 'TERMS', '2099-01-01');

    const blocked = await api.get('/users/me').expect(428);
    expect(blocked.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
    // Exempt routes keep working so the client can show and accept the new text.
    await api.get('/auth/me').expect(200);
    const pending = await api.get('/me/legal/pending').expect(200);
    expect(pending.body.data.pending).toEqual([{ document: 'TERMS', version: '2099-01-01' }]);

    await api.post('/me/legal/accept').send({ acceptances: [] }).expect(400);
    const stale = await api
      .post('/me/legal/accept')
      .send({ acceptances: [{ document: 'TERMS', version: '2026-01-01' }] })
      .expect(409);
    expect(stale.body.code).toBe('TERMS_VERSION_OUTDATED');

    const accept = { acceptances: [{ document: 'TERMS', version: '2099-01-01' }] };
    const accepted = await api.post('/me/legal/accept').set('X-Client-Platform', 'android').send(accept).expect(200);
    expect(accepted.body.data).toEqual({ pending: [] });
    // Idempotent: accepting again succeeds and does not add a row.
    await api.post('/me/legal/accept').send(accept).expect(200);
    const rows = await select<{ channel: string }>(
      `SELECT channel FROM auth.terms_acceptances WHERE user_id = :id AND document = 'TERMS' AND version = '2099-01-01'`,
      { id },
    );
    expect(rows).toEqual([{ channel: 'ANDROID' }]);
    const [account] = await select<{ terms_version: string }>(
      'SELECT terms_version FROM public.usuarios WHERE id = :id',
      { id },
    );
    expect(account.terms_version).toBe('2099-01-01');

    await api.get('/users/me').expect(200);
  });
});
