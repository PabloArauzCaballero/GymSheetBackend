import { existsSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { businessAccountsMigration } from '../src/database/migrations/202611200401-business-accounts';
import { storedNameSkeletonMigration } from '../src/database/migrations/202611200403-stored-name-skeleton';
import { businessKycMigration } from '../src/database/migrations/202611200501-business-kyc';
import { businessListingsMigration } from '../src/database/migrations/202611200601-business-listings';
import { listingVersionStampMigration } from '../src/database/migrations/202611200602-listing-version-stamp';
import { businessNameSkeleton, handleSkeleton } from '../src/modules/business-accounts/handle-rules';
import { E2eApp, bootE2eApp, markEmailVerified } from './support/e2e-app';

type Acceptance = { document: string; version: string; contentSha256: string | null };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('e2e-logo')]);

describe('business accounts and @handles (e2e, franja 8a)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;
  let acceptances: Acceptance[];
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const storedFiles: string[] = [];
  const flagBefore = env.BUSINESS_SIGNUP_ENABLED;

  async function select<T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
    return sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });
  }

  async function signup(label: string, overrides: Record<string, unknown> = {}) {
    const ticket = await request(e2e.http).get(e2e.url('/auth/register/ticket')).expect(200);
    return request(e2e.http)
      .post(e2e.url('/business/signup'))
      .send({
        ticket: ticket.body.data.ticket,
        email: `${label}-${suffix}@example.test`,
        password: 'e2e-strong-password',
        // The suffix keeps names unique across runs: a published name blocks its look-alikes.
        businessName: `Negocio ${label} ${suffix}`,
        entityType: 'GYM',
        acceptances: acceptances.map(({ document, version, contentSha256 }) => ({ document, version, ...(contentSha256 ? { contentSha256 } : {}) })),
        ...overrides,
      });
  }

  /** A signed-up business with its email verified, ready for step 3. */
  async function business(label: string, entityType = 'GYM') {
    const response = await signup(label, { entityType });
    expect(response.status).toBe(201);
    const id = response.body.data.user.id as string;
    await markEmailVerified(e2e.app, id);
    return { id, token: response.body.data.accessToken as string, entityId: response.body.data.business.entityId as string };
  }

  /** What franja 8b's KYC approval will do; set directly here to exercise public handles. */
  async function publish(entityId: string, categoryId: string) {
    await e2e.sql(`UPDATE directory.entities SET status = 'ACTIVE', primary_category_id = :categoryId WHERE id = :entityId`, { entityId, categoryId });
    await e2e.sql(`UPDATE directory.handles SET status = 'ACTIVE' WHERE owner_entity_id = :entityId AND status = 'PENDING'`, { entityId });
  }

  let gymCategoryId: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    env.BUSINESS_SIGNUP_ENABLED = true;
    const legal = await request(e2e.http).get(e2e.url('/legal/current?accountKind=BUSINESS')).expect(200);
    acceptances = legal.body.data.documents;
    [{ id: gymCategoryId }] = await select<{ id: string }>(
      `SELECT id FROM directory.categories WHERE entity_scope IN ('GYM', 'ALL') AND is_active ORDER BY display_order LIMIT 1`,
      {},
    );
  }, 60000);

  afterAll(async () => {
    env.BUSINESS_SIGNUP_ENABLED = flagBefore;
    for (const path of storedFiles) {
      if (existsSync(path)) unlinkSync(path);
      // The listing's own folder (business/{entityId}) holds nothing else from this suite.
      rmSync(dirname(dirname(path)), { recursive: true, force: true });
    }
    await e2e.app.close();
  });

  it('the business legal set is BUSINESS_TERMS, BUSINESS_DPA and PRIVACY, with the hash of each draft text', () => {
    expect(acceptances.map((entry) => entry.document)).toEqual(['BUSINESS_TERMS', 'BUSINESS_DPA', 'PRIVACY']);
    expect(acceptances[0].contentSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('the signup is closed while BUSINESS_SIGNUP_ENABLED is off (404 BUSINESS_SIGNUP_DISABLED)', async () => {
    env.BUSINESS_SIGNUP_ENABLED = false;
    const response = await signup('closed');
    env.BUSINESS_SIGNUP_ENABLED = true;
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('BUSINESS_SIGNUP_DISABLED');
  });

  it('signs up a business: session, DRAFT listing, no person data, business legal set and an email PIN', async () => {
    const response = await signup('happy');
    expect(response.status).toBe(201);
    const data = response.body.data;
    expect(data.user).toMatchObject({ rol: 'NEGOCIO', accountKind: 'BUSINESS', emailVerified: false, nombreCompleto: `Negocio happy ${suffix}` });
    expect(data.business).toMatchObject({ entityType: 'GYM', legalKind: 'COMPANY', status: 'ONBOARDING', kycStatus: 'DRAFT' });
    expect(data.refreshToken).toEqual(expect.any(String));

    const [account] = await select<{ rol: string; genero: string | null; fecha_nacimiento: string | null; status: string }>(
      `SELECT u.rol, u.genero, u.fecha_nacimiento, e.status FROM public.usuarios u
         JOIN business.accounts a ON a.user_id = u.id JOIN directory.entities e ON e.id = a.entity_id WHERE u.id = :id`,
      { id: data.user.id },
    );
    expect(account).toEqual({ rol: 'NEGOCIO', genero: null, fecha_nacimiento: null, status: 'DRAFT' });
    const documents = await select<{ document: string }>(
      'SELECT document FROM auth.terms_acceptances WHERE user_id = :id ORDER BY document',
      { id: data.user.id },
    );
    expect(documents.map((row) => row.document)).toEqual(['BUSINESS_DPA', 'BUSINESS_TERMS', 'PRIVACY']);
    const pins = await select<{ count: number }>('SELECT count(*)::int AS count FROM auth.email_verification_pins WHERE user_id = :id', { id: data.user.id });
    expect(pins[0].count).toBe(1);

    const me = await e2e.as(data.accessToken).get('/auth/me').expect(200);
    expect(me.body.data).toMatchObject({ accountKind: 'BUSINESS', businessEntityId: data.business.entityId });
    // The listing is not public.
    const [{ slug }] = await select<{ slug: string }>('SELECT slug FROM directory.entities WHERE id = :id', { id: data.business.entityId });
    await request(e2e.http).get(e2e.url(`/public/directory/entities/${slug}`)).expect(404);
  });

  it('the database refuses person data on a business account', async () => {
    const { id } = await business('nopersondata');
    await expect(e2e.sql(`UPDATE public.usuarios SET genero = 'MALE' WHERE id = :id`, { id })).rejects.toThrow();
  });

  it('409 EMAIL_ALREADY_REGISTERED for an email in use, by a business or a person', async () => {
    expect((await signup('dup')).status).toBe(201);
    const again = await signup('dup');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    const person = await e2e.register('person-dup');
    const [{ email }] = await select<{ email: string }>('SELECT email FROM public.usuarios WHERE id = :id', { id: person.id });
    const taken = await signup('ignored', { email });
    expect(taken.status).toBe(409);
  });

  it('409 TERMS_VERSION_OUTDATED when the signup does not show the whole current business set', async () => {
    const missing = await signup('outdated', { acceptances: acceptances.slice(0, 1).map(({ document, version }) => ({ document, version })) });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('TERMS_VERSION_OUTDATED');
    const personSet = await signup('personset', { acceptances: [{ document: 'TERMS', version: '2026-08-25' }] });
    expect(personSet.status).toBe(409);
  });

  it('400 for a legal form the type does not admit, and for person fields', async () => {
    const coachCompany = await signup('coach-company', { entityType: 'COACH', legalKind: 'COMPANY' });
    expect(coachCompany.status).toBe(400);
    expect(coachCompany.body.code).toBe('BUSINESS_LEGAL_KIND_INVALID');
    const provider = await signup('provider-nokind', { entityType: 'SERVICE_PROVIDER' });
    expect(provider.body.code).toBe('BUSINESS_LEGAL_KIND_INVALID');
    const coach = await signup('coach-ok', { entityType: 'COACH' });
    expect(coach.status).toBe(201);
    expect(coach.body.data.business.legalKind).toBe('INDIVIDUAL');
  });

  it('428 with the business set: a person document does not satisfy it and cannot be accepted', async () => {
    const owner = await business('legal428');
    await e2e.sql(`DELETE FROM auth.terms_acceptances WHERE user_id = :id AND document = 'BUSINESS_DPA'`, { id: owner.id });
    const blocked = await e2e.as(owner.token).get('/business/me');
    expect(blocked.status).toBe(428);
    expect(blocked.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
    const pending = await e2e.as(owner.token).get('/me/legal/pending').expect(200);
    expect(pending.body.data.pending.map((entry: { document: string }) => entry.document)).toEqual(['BUSINESS_DPA']);
    const wrong = await e2e.as(owner.token).post('/me/legal/accept').send({ acceptances: [{ document: 'TERMS', version: '2026-08-25' }] });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('LEGAL_DOCUMENT_NOT_APPLICABLE');
    const dpa = acceptances.find((entry) => entry.document === 'BUSINESS_DPA')!;
    const accepted = await e2e.as(owner.token).post('/me/legal/accept').send({ acceptances: [{ document: dpa.document, version: dpa.version }] }).expect(200);
    expect(accepted.body.data.pending).toEqual([]);
    await e2e.as(owner.token).get('/business/me').expect(200);
  });

  it('a business token gets 403 ACCOUNT_KIND_NOT_ALLOWED on person surfaces; a person gets 403 on business/*', async () => {
    const owner = await business('kind');
    for (const path of ['/profile', '/me/onboarding', '/me/social-profile', '/social/catalog/interests', '/me/gym-directory',
      '/me/discovery/deck', '/me/conversations', '/workouts', '/me/progression/leaderboard']) {
      const response = await e2e.as(owner.token).get(path);
      expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: 'ACCOUNT_KIND_NOT_ALLOWED' });
    }
    await e2e.as(owner.token).post('/auth/socket-ticket').expect(403);
    const person = await e2e.register('kind-person');
    const refused = await e2e.as(person.token).get('/business/me');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ACCOUNT_KIND_NOT_ALLOWED');
    await e2e.as(person.token).put('/business/me/handle').send({ handle: 'personhandle' }).expect(403);
  });

  it('GET /business/me and PATCH /business/me/profile (step 3), behind a verified email', async () => {
    const response = await signup('profile');
    const token = response.body.data.accessToken as string;
    const me = await e2e.as(token).get('/business/me').expect(200);
    expect(me.body.data.nextSteps).toEqual(['VERIFY_EMAIL', 'CHOOSE_HANDLE', 'COMPLETE_PROFILE', 'SUBMIT_KYC']);
    expect(me.body.data.entity).toMatchObject({ status: 'DRAFT', name: `Negocio profile ${suffix}`, primaryCategoryId: null });
    const unverified = await e2e.as(token).patch('/business/me/profile').send({ city: 'La Paz' });
    expect(unverified.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');

    await markEmailVerified(e2e.app, response.body.data.user.id as string);
    const [{ id: storeCategory }] = await select<{ id: string }>(`SELECT id FROM directory.categories WHERE entity_scope = 'STORE' LIMIT 1`, {});
    await e2e.as(token).patch('/business/me/profile').send({ primaryCategoryId: storeCategory }).expect(400);
    await e2e.as(token).patch('/business/me/profile').send({ isVerified: true }).expect(400);
    const patched = await e2e.as(token).patch('/business/me/profile')
      .send({ name: `Top Fit Center ${suffix}`, city: 'La Paz', primaryCategoryId: gymCategoryId, businessHours: { mon: { open: '06:00', close: '22:00' } } })
      .expect(200);
    expect(patched.body.data.entity).toMatchObject({ name: `Top Fit Center ${suffix}`, city: 'La Paz', primaryCategoryId: gymCategoryId });
    expect(patched.body.data.nextSteps).toEqual(['CHOOSE_HANDLE', 'SUBMIT_KYC']);
    const auth = await e2e.as(token).get('/auth/me').expect(200);
    expect(auth.body.data.nombreCompleto).toBe(`Top Fit Center ${suffix}`);
  });

  it('POST /business/me/media: public logo under business/{entityId}/public/, the replaced one is released', async () => {
    const owner = await business('media');
    const upload = (buffer: Buffer, type = 'image/png') =>
      e2e.as(owner.token).post('/business/me/media').field('slot', 'LOGO').attach('file', buffer, { filename: 'logo.png', contentType: type });
    const first = await upload(PNG).expect(201);
    expect(first.body.data.url).toContain(`/business/${owner.entityId}/public/`);
    const firstKey = (first.body.data.url as string).split('/').slice(-4).join('/');
    storedFiles.push(join(env.MEDIA_STORAGE_LOCAL_ROOT, firstKey));
    const second = await upload(Buffer.concat([PNG, Buffer.from('v2')])).expect(201);
    storedFiles.push(join(env.MEDIA_STORAGE_LOCAL_ROOT, (second.body.data.url as string).split('/').slice(-4).join('/')));
    const released = await select<{ count: number }>(
      `SELECT count(*)::int AS count FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND payload->>'storageKey' = :key`,
      { key: firstKey },
    );
    expect(released[0].count).toBe(1);
    await upload(Buffer.from('not an image')).expect(400);
    await e2e.as(owner.token).del('/business/me/media/LOGO').expect(204);
    const me = await e2e.as(owner.token).get('/business/me').expect(200);
    expect(me.body.data.entity.logoUrl).toBeNull();
  });

  it('handles: availability with its reason, PENDING reservation, collisions and look-alikes', async () => {
    const http = (path: string) => request(e2e.http).get(e2e.url(path));
    const handle = `topfit${suffix.slice(-6)}`;
    expect((await http('/public/handles/admin/availability').expect(200)).body.data).toEqual({ handle: 'admin', available: false, reason: 'RESERVED' });
    expect((await http('/public/handles/ab/availability').expect(200)).body.data).toMatchObject({ available: false, reason: 'INVALID' });
    expect((await http(`/public/handles/@${handle.toUpperCase()}/availability`).expect(200)).body.data).toEqual({ handle, available: true, reason: null });

    const owner = await business('handle-a');
    const claimed = await e2e.as(owner.token).put('/business/me/handle').send({ handle: `@${handle}` }).expect(200);
    expect(claimed.body.data).toEqual({ handle, status: 'PENDING' });
    expect((await http(`/public/handles/${handle}/availability`)).body.data.reason).toBe('TAKEN');
    expect((await http(`/public/handles/${handle.replace('o', '0')}/availability`)).body.data.reason).toBe('TOO_SIMILAR');
    // PENDING is not public.
    await http(`/public/handles/${handle}`).expect(404);

    const rival = await business('handle-b');
    const taken = await e2e.as(rival.token).put('/business/me/handle').send({ handle });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('HANDLE_TAKEN');
    const similar = await e2e.as(rival.token).put('/business/me/handle').send({ handle: handle.replace('t', 't.') });
    expect(similar.status).toBe(422);
    expect(similar.body.code).toBe('HANDLE_TOO_SIMILAR');
    const reserved = await e2e.as(rival.token).put('/business/me/handle').send({ handle: 'repp_gym' });
    expect(reserved.body.code).toBe('HANDLE_RESERVED');
    const invalid = await e2e.as(rival.token).put('/business/me/handle').send({ handle: '12345678' });
    expect(invalid.body.code).toBe('HANDLE_INVALID');

    // While DRAFT the business may change its reservation freely; the old one is free again.
    await e2e.as(owner.token).put('/business/me/handle').send({ handle: `${handle}x` }).expect(200);
    await e2e.as(rival.token).put('/business/me/handle').send({ handle }).expect(200);
  });

  it('a PENDING reservation expires 14 days after the listing was created; re-claiming never extends it', async () => {
    const handle = `stale${suffix.slice(-6)}`;
    const ageListing = (entityId: string, days: number) =>
      e2e.sql(`UPDATE directory.entities SET created_at = now() - make_interval(days => :days) WHERE id = :entityId`, { entityId, days });
    const first = await business('stale-a');
    await e2e.as(first.token).put('/business/me/handle').send({ handle }).expect(200);
    // Day 13: re-claiming the same handle succeeds but moves no clock.
    await ageListing(first.entityId, 13);
    await e2e.as(first.token).put('/business/me/handle').send({ handle }).expect(200);
    await ageListing(first.entityId, 15);
    const again = await e2e.as(first.token).put('/business/me/handle').send({ handle });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('HANDLE_RESERVATION_EXPIRED');
    expect((await e2e.as(first.token).get('/business/me').expect(200)).body.data.handle).toBeNull();
    expect((await request(e2e.http).get(e2e.url(`/public/handles/${handle}/availability`))).body.data.available).toBe(true);

    const second = await business('stale-b');
    await e2e.as(second.token).put('/business/me/handle').send({ handle }).expect(200);
    const rows = await select<{ owner_entity_id: string }>('SELECT owner_entity_id FROM directory.handles WHERE handle = :handle', { handle });
    expect(rows).toEqual([{ owner_entity_id: second.entityId }]);
  });

  it('the business name is material: checked like a handle while DRAFT, a review once public', async () => {
    const tag = suffix.slice(-6);
    const owner = await business('name-a');
    const patchName = (token: string, name: string) => e2e.as(token).patch('/business/me/profile').send({ name });
    expect((await patchName(owner.token, 'Soporte REPP')).body.code).toBe('BUSINESS_NAME_RESERVED');
    expect((await patchName(owner.token, 'Adm1n')).body.code).toBe('BUSINESS_NAME_RESERVED');
    expect((await patchName(owner.token, `Top Fіt ${tag}`)).body.code).toBe('BUSINESS_NAME_INVALID'); // Cyrillic "і"
    const brand = `acmebrand${tag}`;
    await e2e.sql(`INSERT INTO directory.handles (handle, skeleton, status) VALUES (:brand, :skeleton, 'RESERVED')`, {
      brand,
      skeleton: handleSkeleton(brand),
    });
    const branded = await patchName(owner.token, `ACME Brand ${tag}`);
    expect([branded.status, branded.body.code]).toEqual([422, 'BUSINESS_NAME_RESERVED']);
    const reservedAtSignup = await signup('name-signup', { businessName: 'Repp Oficial' });
    expect([reservedAtSignup.status, reservedAtSignup.body.code]).toEqual([422, 'BUSINESS_NAME_RESERVED']);

    // A public GYM named like this blocks look-alikes of the same type, not of another type.
    const known = await business('name-known');
    await patchName(known.token, `Fuerza Norte ${tag}`).expect(200);
    await publish(known.entityId, gymCategoryId);
    const lookAlike = await patchName(owner.token, `FUERZA-N0RTE ${tag}`);
    expect([lookAlike.status, lookAlike.body.code]).toEqual([422, 'BUSINESS_NAME_TOO_SIMILAR']);
    const copied = await signup('name-copy', { businessName: `Fuerza Norte ${tag}` });
    expect(copied.body.code).toBe('BUSINESS_NAME_TOO_SIMILAR');
    expect((await signup('name-store', { businessName: `Fuerza Norte ${tag}`, entityType: 'STORE' })).status).toBe(201);
    await patchName(owner.token, `Fuerza Sur ${tag}`).expect(200);

    // Past DRAFT: the name and the category do not publish; other fields and unchanged values do.
    const blocked = await patchName(known.token, `Nike ${tag}`);
    expect([blocked.status, blocked.body.code]).toEqual([409, 'BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW']);
    const [{ id: otherCategory }] = await select<{ id: string }>(
      `INSERT INTO directory.categories (slug, path, name, entity_scope, display_order)
       VALUES (:slug, :slug, 'E2E gym', 'GYM', 9999) RETURNING id`,
      { slug: `e2e-gym-${suffix}` },
    );
    const recategorized = await e2e.as(known.token).patch('/business/me/profile').send({ primaryCategoryId: otherCategory });
    expect(recategorized.body.code).toBe('BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW');
    const kept = await e2e.as(known.token).patch('/business/me/profile')
      .send({ name: `Fuerza Norte ${tag}`, primaryCategoryId: gymCategoryId, city: 'Sucre' })
      .expect(200);
    expect(kept.body.data.entity).toMatchObject({ name: `Fuerza Norte ${tag}`, primaryCategoryId: gymCategoryId, city: 'Sucre' });
  });

  it('a public handle resolves; a rename leaves a redirect, a lock and a limit', async () => {
    const http = (path: string) => request(e2e.http).get(e2e.url(path));
    const oldHandle = `fuerza${suffix.slice(-6)}`;
    const newHandle = `fuerzamax${suffix.slice(-6)}`;
    const owner = await business('rename');
    await e2e.as(owner.token).put('/business/me/handle').send({ handle: oldHandle }).expect(200);
    await publish(owner.entityId, gymCategoryId);
    const resolved = await http(`/public/handles/${oldHandle}`).expect(200);
    expect(resolved.body.data).toMatchObject({ handle: oldHandle, entity: { id: owner.entityId } });

    const renamed = await e2e.as(owner.token).put('/business/me/handle').send({ handle: newHandle }).expect(200);
    expect(renamed.body.data).toEqual({ handle: newHandle, status: 'ACTIVE' });
    expect((await http(`/public/handles/${oldHandle}`).expect(200)).body.data).toEqual({ redirectTo: newHandle });
    expect((await http(`/public/handles/${newHandle}`).expect(200)).body.data.entity.id).toBe(owner.entityId);
    const [change] = await select<{ from_handle: string; to_handle: string }>(
      'SELECT from_handle, to_handle FROM directory.handle_changes WHERE entity_id = :id',
      { id: owner.entityId },
    );
    expect(change).toEqual({ from_handle: oldHandle, to_handle: newHandle });

    const limited = await e2e.as(owner.token).put('/business/me/handle').send({ handle: `${newHandle}z` });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('HANDLE_RENAME_LIMIT');
    const squatter = await business('squatter');
    const locked = await e2e.as(squatter.token).put('/business/me/handle').send({ handle: oldHandle });
    expect(locked.body.code).toBe('HANDLE_TAKEN');
  });

  it('a business never appears among persons: gym directory, profile, connections, leaderboard', async () => {
    const owner = await business('invisible');
    await e2e.sql('INSERT INTO progression.user_progress (usuario_id, points) VALUES (:id, 999999)', { id: owner.id });
    const person = await e2e.register('invisible-viewer');
    const directory = await e2e.as(person.token).get('/me/gym-directory?q=Negocio').expect(200);
    expect(JSON.stringify(directory.body.data)).not.toContain(owner.id);
    await e2e.as(person.token).get(`/me/gym-directory/${owner.id}`).expect(404);
    await e2e.as(person.token).post('/me/connections').send({ addresseeId: owner.id }).expect(404);
    const board = await e2e.as(person.token).get('/me/progression/leaderboard').expect(200);
    expect((board.body.data as { userId: string }[]).map((row) => row.userId)).not.toContain(owner.id);
  });

  it('a look-alike of a public name of the same type is refused: allowlisted characters, one stored fold', async () => {
    const tag = suffix.slice(-6);
    const known = await business('mundo-known');
    const patchName = (token: string, name: string) => e2e.as(token).patch('/business/me/profile').send({ name });
    await patchName(known.token, `Mundo Fuerte ${tag}`).expect(200);
    await publish(known.entityId, gymCategoryId);
    const [stored] = await select<{ name_skeleton: string }>('SELECT name_skeleton FROM directory.entities WHERE id = :id', { id: known.entityId });
    expect(stored.name_skeleton).toBe(businessNameSkeleton(`Mundo Fuerte ${tag}`));

    const second = await business('mundo-second');
    // `rn` reads as `m`: before, the two skeletons differed and the copy was accepted.
    const pair = await patchName(second.token, `Rnundo Fuerte ${tag}`);
    expect([pair.status, pair.body.code]).toEqual([422, 'BUSINESS_NAME_TOO_SIMILAR']);
    // An Arabic-Indic five looks like `o`: before, it was deleted from the skeleton and the name passed.
    const digit = await patchName(second.token, `Mund٥ Fuerte ${tag}`);
    expect([digit.status, digit.body.code]).toEqual([422, 'BUSINESS_NAME_INVALID']);
    const atSignup = await signup('mundo-signup', { businessName: `RNUNDO-FUERTE ${tag}` });
    expect([atSignup.status, atSignup.body.code]).toEqual([422, 'BUSINESS_NAME_TOO_SIMILAR']);
    const invalidAtSignup = await signup('mundo-invalid', { businessName: `Mundo Fuеrte ${tag}` }); // Cyrillic "е"
    expect([invalidAtSignup.status, invalidAtSignup.body.code]).toEqual([422, 'BUSINESS_NAME_INVALID']);
    await patchName(second.token, `Mundo Débil ${tag}`).expect(200);
  });

  it('migration 202611200403 goes down and up again and backfills the stored skeletons', async () => {
    const owner = await business('skeleton-migration');
    // Letters only (no `i`, no digits), so the previous fold leaves the handle as it is.
    const handle = `rnzz${suffix.slice(-8).replace(/\d/gu, (digit) => 'abcdefghjk'[Number(digit)])}`;
    await e2e.as(owner.token).put('/business/me/handle').send({ handle }).expect(200);
    const queryInterface = sequelize.getQueryInterface();
    const transaction = await sequelize.transaction();
    const read = async () => {
      const [row] = await sequelize.query<{ column: string | null; fn: string | null; skeleton: string }>(
        `SELECT (SELECT column_name::text FROM information_schema.columns
                  WHERE table_schema = 'directory' AND table_name = 'entities' AND column_name = 'name_skeleton') AS column,
                to_regprocedure('directory.business_name_skeleton(text)')::text AS fn,
                (SELECT skeleton FROM directory.handles WHERE handle = :handle) AS skeleton`,
        { type: QueryTypes.SELECT, replacements: { handle }, transaction },
      );
      return row;
    };
    try {
      expect(await read()).toEqual({ column: 'name_skeleton', fn: null, skeleton: handleSkeleton(handle) });
      await storedNameSkeletonMigration.down(queryInterface, transaction);
      // The previous fold had no letter pairs: `rn` stays as it is.
      expect(await read()).toEqual({ column: null, fn: 'directory.business_name_skeleton(text)', skeleton: handle });
      await storedNameSkeletonMigration.up(queryInterface, transaction);
      expect(await read()).toEqual({ column: 'name_skeleton', fn: null, skeleton: handleSkeleton(handle) });
      const [entity] = await sequelize.query<{ name: string; name_skeleton: string }>(
        'SELECT name, name_skeleton FROM directory.entities WHERE id = :id',
        { type: QueryTypes.SELECT, replacements: { id: owner.entityId }, transaction },
      );
      expect(entity.name_skeleton).toBe(businessNameSkeleton(entity.name));
    } finally {
      await transaction.rollback();
    }
  });

  it('migration 202611200401 goes down and up again (inside a transaction that is rolled back)', async () => {
    const owner = await business('migration');
    const queryInterface = sequelize.getQueryInterface();
    const transaction = await sequelize.transaction();
    try {
      // Migrations roll back in reverse order: the listings (202611200601) and the KYC tables (202611200501) come after business.accounts.
      await listingVersionStampMigration.down(queryInterface, transaction);
      await businessListingsMigration.down(queryInterface, transaction);
      await businessKycMigration.down(queryInterface, transaction);
      await businessAccountsMigration.down(queryInterface, transaction);
      const [user] = await sequelize.query<{ rol: string; estado: string }>(
        'SELECT rol, estado FROM public.usuarios WHERE id = :id',
        { type: QueryTypes.SELECT, replacements: { id: owner.id }, transaction },
      );
      expect(user).toEqual({ rol: 'CLIENTE', estado: 'INACTIVO' });
      const [tables] = await sequelize.query<{ accounts: string | null; handles: string | null }>(
        `SELECT to_regclass('business.accounts')::text AS accounts, to_regclass('directory.handles')::text AS handles`,
        { type: QueryTypes.SELECT, transaction },
      );
      expect(tables).toEqual({ accounts: null, handles: null });
      await businessAccountsMigration.up(queryInterface, transaction);
      await businessKycMigration.up(queryInterface, transaction);
      await businessListingsMigration.up(queryInterface, transaction);
      await listingVersionStampMigration.up(queryInterface, transaction);
      const [again] = await sequelize.query<{ accounts: string | null }>(
        `SELECT to_regclass('business.accounts')::text AS accounts`,
        { type: QueryTypes.SELECT, transaction },
      );
      expect(again.accounts).toBe('business.accounts');
    } finally {
      await transaction.rollback();
    }
    await e2e.as(owner.token).get('/business/me').expect(200);
  });
});
