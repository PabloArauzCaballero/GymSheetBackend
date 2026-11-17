import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { VerificationRepository } from '../src/modules/verification/verification.repository';
import { VerificationRetentionService } from '../src/modules/verification/verification-retention.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { bootE2eApp, type E2eApp } from './support/e2e-app';
import { registerModerator } from './support/moderation-e2e';
import { grantConsent, selectRowsEventually } from './support/privacy-e2e';

/**
 * Person verification (franja 6) against PostgreSQL: gesture challenge →
 * private selfie → review queue of the central REPP team (ADR-0018) → decision
 * → verified_at, its effect on the Conocer deck, the photo replacement rule,
 * the VERIFICATION_SELFIE consent (required; revoking it erases the selfies),
 * the review deadline, limits and authorization.
 */
describe('Photo verification (e2e)', () => {
  jest.setTimeout(90000);
  let e2e: E2eApp;
  let sequelize: Sequelize;
  // The selfie step of `yarn db:privacy:retention`, built on the app connection
  // (a second Nest context would rebind the global models).
  let retention: VerificationRetentionService;
  let mediaRelease: MediaReleaseService;
  const tenant = `verif-e2e-${Date.now().toString(36)}`;
  const otherTenant = `${tenant}-b`;
  const branch = randomUUID();
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  type Account = { token: string; id: string };
  const fixedCreatedAt = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  async function member(label: string, gender: 'MALE' | 'FEMALE', photos = 2): Promise<Account> {
    const account = await e2e.register(label);
    await e2e.sql(
      `UPDATE public.usuarios SET tenant_id = :tenant, genero = :gender, sede_id = :branch,
              created_at = :fixedCreatedAt, last_active_at = date_trunc('minute', now()) WHERE id = :id`,
      { tenant, gender, branch, fixedCreatedAt, id: account.id },
    );
    for (let position = 0; position < photos; position += 1) {
      await e2e.sql(
        `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key, position)
         VALUES (:id, 'http://localhost/p.jpg', 'local', :key, :position)`,
        { id: account.id, key: `verif-e2e/${account.id}/${position}`, position },
      );
    }
    await grantConsent(e2e, account.token, 'VERIFICATION_SELFIE');
    const api = e2e.as(account.token);
    await api.patch('/me/social-discovery-settings')
      .send({ profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0 }).expect(200);
    await api.put('/me/discovery/preferences')
      .send({
        genders: [gender === 'MALE' ? 'FEMALE' : 'MALE'], intents: ['TRAINING'], minAge: 18, maxAge: 60,
        radiusKm: 10, flexibleAge: false, flexibleDistance: false, expectedVersion: 0,
      }).expect(200);
    return account;
  }

  /** Gym staff of `tenantId`, optionally with the retired `moderation:*` grants (which open nothing now). */
  async function gymStaff(label: string, role: 'ADMIN' | 'FRONT_DESK', tenantId: string, keys: string[] = []): Promise<Account> {
    const account = await e2e.register(label);
    await e2e.promote(account.id, role);
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :id', { tenantId, id: account.id });
    for (const key of keys) {
      await e2e.sql(
        `INSERT INTO admin.permissions (key, label, description, domain) VALUES (:key, :key, 'e2e', 'moderation')
         ON CONFLICT (key) DO NOTHING`, { key });
      await e2e.sql(
        `INSERT INTO admin.user_permissions (id, user_id, permission_key) VALUES (gen_random_uuid(), :id, :key)`,
        { id: account.id, key });
    }
    return account;
  }
  const legacyGrants = ['moderation:read', 'moderation:act'];

  async function one<T extends object>(statement: string, replacements: Record<string, unknown>): Promise<T> {
    const [row] = await sequelize.query<T>(statement, { type: QueryTypes.SELECT, replacements });
    if (!row) throw new Error(`no row for: ${statement}`);
    return row;
  }
  const upload = (account: Account, id: string) =>
    e2e.as(account.token).post(`/me/verification/${id}/selfie`).attach('file', JPEG, { filename: 's.jpg', contentType: 'image/jpeg' });
  async function submitted(account: Account): Promise<string> {
    const challenge = await e2e.as(account.token).post('/me/verification/challenge').expect(201);
    await upload(account, challenge.body.data.id).expect(201);
    return challenge.body.data.id as string;
  }

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    mediaRelease = e2e.app.get(MediaReleaseService, { strict: false });
    retention = new VerificationRetentionService(
      e2e.app.get(VerificationRepository, { strict: false }),
      mediaRelease,
      e2e.app.get(NotificationService, { strict: false }),
    );
    for (const id of [tenant, otherTenant]) await e2e.sql('INSERT INTO tenants (id, nombre) VALUES (:id, :id)', { id });
    await e2e.sql(
      `INSERT INTO facilities.branches (id, code, name, time_zone, latitude, longitude, tenant_id)
       VALUES (:branch, :code, :code, 'America/La_Paz', -17.78, -63.18, :tenant)`,
      { branch, code: `verif-${branch.slice(0, 8)}`, tenant },
    );
  }, 60000);

  afterAll(async () => {
    await e2e?.app.close();
  });

  it('runs the full cycle, ranks the verified member first and revokes on photo replacement', async () => {
    const viewer = await member('v-viewer', 'MALE');
    const ana = await member('v-ana', 'FEMALE');
    const bea = await member('v-bea', 'FEMALE');
    // The REPP moderator belongs to the default gym and reviews the members of every gym.
    const mod = await registerModerator(e2e, 'v-mod');
    const otherModerator = await registerModerator(e2e, 'v-mod-other');
    const gymAdmin = await gymStaff('v-gym-admin', 'ADMIN', tenant, legacyGrants);
    const anaApi = e2e.as(ana.token);

    expect((await anaApi.get('/me/verification').expect(200)).body.data).toMatchObject({ status: 'NONE', verifiedAt: null });
    const challenge = (await anaApi.post('/me/verification/challenge').expect(201)).body.data;
    expect(challenge).toEqual({
      id: expect.any(String), gesture: { code: expect.any(String), instruction: expect.any(String) }, expiresAt: expect.any(String),
    });
    await upload(bea, challenge.id).expect(404);
    expect((await upload(ana, challenge.id).expect(201)).body.data.status).toBe('PENDING_REVIEW');
    await upload(ana, challenge.id).expect(409);
    const stored = await one<{ key: string }>(
      'SELECT selfie_storage_key AS key FROM social.photo_verifications WHERE id = :id', { id: challenge.id });
    expect(stored.key).toMatch(new RegExp(`^users/${ana.id}/verificaciones/`));
    expect(existsSync(join(env.MEDIA_STORAGE_LOCAL_ROOT, stored.key))).toBe(true);

    const queue = (await e2e.as(mod.token).get('/admin/verifications?status=PENDING_REVIEW&limit=50').expect(200)).body.data;
    const item = queue.find((entry: { id: string }) => entry.id === challenge.id);
    expect(item).toMatchObject({
      member: { id: ana.id }, tenantId: tenant, tenantName: tenant, gesture: challenge.gesture, profilePhotos: [{}, {}],
    });
    expect(JSON.stringify(item)).not.toContain(stored.key);
    const selfiePath = String(item.selfie.url).replace(`/${env.API_PREFIX}`, '');
    const selfie = await e2e.as(mod.token).get(selfiePath).expect(200);
    expect(selfie.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(selfie.body as Buffer).equals(JPEG)).toBe(true);
    // The signed link is bound to the moderator it was issued to.
    await e2e.as(otherModerator.token).get(selfiePath).expect(403);
    await e2e.as(mod.token).get(selfiePath.replace(/signature=[^&]+/, `signature=${'A'.repeat(43)}`)).expect(403);
    // The gym of the member never sees the selfie, legacy grants or not (BFLA).
    await e2e.as(gymAdmin.token).get('/admin/verifications').expect(403);
    await e2e.as(gymAdmin.token).get(selfiePath).expect(403);
    await e2e.as(gymAdmin.token).post(`/admin/verifications/${challenge.id}/decide`).send({ decision: 'APPROVE', comparedPhotoIds: [randomUUID()] }).expect(403);

    const before = (await e2e.as(viewer.token).get('/me/discovery/deck?limit=10').expect(200)).body.data;
    expect(before.find((card: { userId: string }) => card.userId === ana.id)?.reasons ?? []).not.toContain('VERIFIED');

    // The approval is bound to the photos the moderator saw in the queue.
    const comparedPhotoIds = (item.profilePhotos as Array<{ id: string }>).map((photo) => photo.id);
    await e2e.as(mod.token).post(`/admin/verifications/${challenge.id}/decide`).send({ decision: 'APPROVE' }).expect(400);
    const stale = await e2e
      .as(mod.token)
      .post(`/admin/verifications/${challenge.id}/decide`)
      .send({ decision: 'APPROVE', comparedPhotoIds: [comparedPhotoIds[0], randomUUID()] })
      .expect(409);
    expect(stale.body.code).toBe('VERIFICATION_PHOTOS_CHANGED');
    await e2e.as(mod.token).post(`/admin/verifications/${challenge.id}/decide`).send({ decision: 'APPROVE', comparedPhotoIds }).expect(200);
    await e2e.as(mod.token).post(`/admin/verifications/${challenge.id}/decide`).send({ decision: 'APPROVE', comparedPhotoIds }).expect(409);
    // One audit row per decision, a platform row (no gym scope) naming the moderator and the member's gym.
    const audit = await selectRowsEventually<{ actor_user_id: string; actor_role: string; tenant_scope: string | null; metadata: object }>(e2e,
      `SELECT actor_user_id, actor_role, tenant_scope, metadata FROM admin.audit_log
        WHERE domain = 'verification' AND action = 'decide' AND target_id = :id`, { id: challenge.id });
    expect(audit).toEqual([{
      actor_user_id: mod.id, actor_role: 'MODERATOR', tenant_scope: null,
      metadata: { tenantId: tenant, decision: 'APPROVED', reason: null },
    }]);
    const state = (await anaApi.get('/me/verification').expect(200)).body.data;
    expect(state).toMatchObject({ status: 'APPROVED', verifiedAt: expect.any(String), lastDecision: { decision: 'APPROVED' } });
    expect((await anaApi.get('/users/me').expect(200)).body.data.verified).toBe(true);
    expect((await anaApi.get('/auth/me').expect(200)).body.data.verified).toBe(true);
    expect((await e2e.as(bea.token).get('/users/me').expect(200)).body.data.verified).toBe(false);
    const notice = await one<{ subject: string; body: string }>(
      `SELECT subject, body FROM notifications.messages WHERE recipient_user_id = :id AND deduplication_key = :key`,
      { id: ana.id, key: `verification.decided:${challenge.id}` });
    expect(notice.subject).toBe('Tu perfil está verificado');
    expect(notice.body).toContain('El equipo de REPP');
    expect(notice.body).not.toMatch(/gimnasio/iu);
    await anaApi.post('/me/verification/challenge').expect(409);

    const deck = (await e2e.as(viewer.token).get('/me/discovery/deck?limit=10').expect(200)).body.data;
    const ids = deck.map((card: { userId: string }) => card.userId);
    expect(ids.indexOf(ana.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(ana.id)).toBeLessThan(ids.indexOf(bea.id));
    expect(deck[ids.indexOf(ana.id)].reasons).toContain('VERIFIED');

    // Photo replacement rule: adding keeps the badge, removing every compared photo clears it.
    const photos = (await anaApi.get('/me/photos').expect(200)).body.data as { id: string }[];
    await anaApi.post('/me/photos').attach('file', JPEG, { filename: 'n.jpg', contentType: 'image/jpeg' }).expect(201);
    await anaApi.del(`/me/photos/${photos[0].id}`).expect(200);
    expect((await anaApi.get('/users/me').expect(200)).body.data.verified).toBe(true);
    await anaApi.del(`/me/photos/${photos[1].id}`).expect(200);
    expect((await anaApi.get('/users/me').expect(200)).body.data.verified).toBe(false);
    expect((await anaApi.get('/me/verification').expect(200)).body.data).toMatchObject({ status: 'REVOKED', verifiedAt: null });

    // Retention: 30 days after the decision the selfie file and key are gone, the row stays.
    await e2e.sql(`UPDATE social.photo_verifications SET decided_at = now() - interval '31 days' WHERE id = :id`, { id: challenge.id });
    const result = await retention.purge(new Date());
    expect(result.selfiesErased).toBeGreaterThanOrEqual(1);
    // The file goes through the shared media.release outbox queue.
    expect(existsSync(join(env.MEDIA_STORAGE_LOCAL_ROOT, stored.key))).toBe(true);
    await mediaRelease.drainOnce();
    const after = await one<{ key: string | null; status: string; deleted: Date | null }>(
      `SELECT selfie_storage_key AS key, status, selfie_deleted_at AS deleted FROM social.photo_verifications WHERE id = :id`,
      { id: challenge.id });
    expect(after).toMatchObject({ key: null, status: 'APPROVED', deleted: expect.any(Date) });
    expect(existsSync(join(env.MEDIA_STORAGE_LOCAL_ROOT, stored.key))).toBe(false);
  });

  it('rejects with a closed-list reason and lets the member retry with a new gesture', async () => {
    const cata = await member('v-cata', 'FEMALE');
    const mod = await registerModerator(e2e, 'v-mod2');
    const id = await submitted(cata);
    const decide = (body: object) => e2e.as(mod.token).post(`/admin/verifications/${id}/decide`).send(body);
    await decide({ decision: 'REJECT' }).expect(400);
    await decide({ decision: 'REJECT', reason: 'BLURRY' }).expect(400);
    await decide({ decision: 'REJECT', reason: 'GESTURE_MISMATCH' }).expect(200);
    const state = (await e2e.as(cata.token).get('/me/verification').expect(200)).body.data;
    expect(state).toMatchObject({ status: 'REJECTED', verifiedAt: null, lastDecision: { reason: 'GESTURE_MISMATCH', reasonText: expect.any(String) } });
    const notice = await one<{ body: string }>(
      `SELECT body FROM notifications.messages WHERE deduplication_key = :key`, { key: `verification.decided:${id}` });
    expect(notice.body).toContain('El gesto de la selfie no coincide');
    expect(notice.body).toContain('El equipo de REPP');
    const [audit] = await selectRowsEventually<{ metadata: object }>(e2e,
      `SELECT metadata FROM admin.audit_log WHERE domain = 'verification' AND action = 'decide' AND target_id = :id`, { id });
    expect(audit.metadata).toEqual({ tenantId: tenant, decision: 'REJECTED', reason: 'GESTURE_MISMATCH' });
    const first = await one<{ code: string }>('SELECT gesture_code AS code FROM social.photo_verifications WHERE id = :id', { id });
    const retry = (await e2e.as(cata.token).post('/me/verification/challenge').expect(201)).body.data;
    expect(retry.gesture.code).not.toBe(first.code);
    await e2e.sql(`UPDATE social.photo_verifications SET decided_at = now() - interval '31 days' WHERE id = :id`, { id });
    await retention.purge(new Date());
    await mediaRelease.drainOnce();
  });

  it('expires a review the REPP team left undecided for 30 days, erases the selfie and lets the member retry', async () => {
    const mod = await registerModerator(e2e, 'v-mod-deadline');
    const eli = await member('v-eli', 'FEMALE');
    const fay = await member('v-fay', 'FEMALE');
    // Eli belongs to another gym: the REPP queue carries both gyms.
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :otherTenant WHERE id = :id', { otherTenant, id: eli.id });
    const [overdueId, recentId] = [await submitted(eli), await submitted(fay)];
    const queue = (await e2e.as(mod.token).get('/admin/verifications?status=PENDING_REVIEW&limit=50').expect(200)).body.data as
      { id: string; tenantId: string }[];
    expect(queue.find((entry) => entry.id === overdueId)?.tenantId).toBe(otherTenant);
    expect(queue.find((entry) => entry.id === recentId)?.tenantId).toBe(tenant);
    const { key } = await one<{ key: string }>('SELECT selfie_storage_key AS key FROM social.photo_verifications WHERE id = :id', { id: overdueId });
    await e2e.sql(`UPDATE social.photo_verifications SET submitted_at = now() - interval '31 days' WHERE id = :id`, { id: overdueId });
    await e2e.sql(`UPDATE social.photo_verifications SET submitted_at = now() - interval '29 days' WHERE id = :id`, { id: recentId });

    const result = await retention.purge(new Date());
    expect(result.expiredReviews).toBeGreaterThanOrEqual(1);
    const attempt = (id: string) => one<{ status: string; key: string | null; deleted: Date | null }>(
      'SELECT status, selfie_storage_key AS key, selfie_deleted_at AS deleted FROM social.photo_verifications WHERE id = :id', { id });
    expect(await attempt(overdueId)).toEqual({ status: 'EXPIRED', key: null, deleted: expect.any(Date) });
    expect(await attempt(recentId)).toMatchObject({ status: 'PENDING_REVIEW', key: expect.any(String) });
    // The file leaves through the shared media.release queue.
    await mediaRelease.drainOnce();
    expect(existsSync(join(env.MEDIA_STORAGE_LOCAL_ROOT, key))).toBe(false);

    const notice = await one<{ subject: string; body: string; metadata: object }>(
      `SELECT subject, body, metadata FROM notifications.messages WHERE recipient_user_id = :id AND deduplication_key = :key`,
      { id: eli.id, key: `verification.review-expired:${overdueId}` });
    expect(notice.metadata).toMatchObject({ kind: 'PHOTO_VERIFICATION', verificationId: overdueId, outcome: 'REVIEW_EXPIRED' });
    expect(notice.body).toContain('El equipo de REPP');
    expect(notice.body).not.toMatch(/gimnasio/iu);
    // A second pass neither expires nor notifies again.
    await retention.purge(new Date());
    const notices = await sequelize.query('SELECT 1 FROM notifications.messages WHERE deduplication_key = :key',
      { type: QueryTypes.SELECT, replacements: { key: `verification.review-expired:${overdueId}` } });
    expect(notices).toHaveLength(1);

    const after = (await e2e.as(mod.token).get('/admin/verifications?status=PENDING_REVIEW&limit=50').expect(200)).body.data as { id: string }[];
    expect(after.map((entry) => entry.id)).not.toContain(overdueId);
    const late = await e2e.as(mod.token).post(`/admin/verifications/${overdueId}/decide`).send({ decision: 'REJECT', reason: 'OTHER' }).expect(409);
    expect(late.body.code).toBe('VERIFICATION_CHALLENGE_EXPIRED');
    expect((await e2e.as(eli.token).get('/me/verification').expect(200)).body.data).toMatchObject({ status: 'EXPIRED', canRetryAt: null });
    await e2e.as(eli.token).post('/me/verification/challenge').expect(201);
  });

  it('expires the challenge after 10 minutes and caps attempts at three per 24 h', async () => {
    const dora = await member('v-dora', 'FEMALE');
    const api = e2e.as(dora.token);
    const gestures: string[] = [];
    const first = (await api.post('/me/verification/challenge').expect(201)).body.data;
    gestures.push(first.gesture.code);
    await e2e.sql(
      `UPDATE social.photo_verifications SET challenge_issued_at = now() - interval '11 minutes',
              challenge_expires_at = now() - interval '1 minute' WHERE id = :id`, { id: first.id });
    const expired = await upload(dora, first.id).expect(409);
    expect(expired.body.code).toBe('VERIFICATION_CHALLENGE_EXPIRED');
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      const next = (await api.post('/me/verification/challenge').expect(201)).body.data;
      expect(next.gesture.code).not.toBe(gestures.at(-1));
      gestures.push(next.gesture.code);
    }
    const limited = await api.post('/me/verification/challenge').expect(429);
    expect(limited.body.code).toBe('VERIFICATION_RATE_LIMITED');
    expect(limited.body.details.retryAfterSeconds).toBeGreaterThan(23 * 3600);
    expect((await api.get('/me/verification').expect(200)).body.data.canRetryAt).toEqual(expect.any(String));
  });

  it('enforces photos, email, member-only and the platform review roles', async () => {
    const lone = await member('v-lone', 'FEMALE', 1);
    const missing = await e2e.as(lone.token).post('/me/verification/challenge').expect(400);
    expect(missing.body.code).toBe('VERIFICATION_PHOTOS_REQUIRED');

    const unverified = await e2e.register('v-unverified', { verifyEmail: false });
    const blocked = await e2e.as(unverified.token).post('/me/verification/challenge').expect(403);
    expect(blocked.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');

    const staff = await gymStaff('v-staff', 'ADMIN', tenant);
    await e2e.as(staff.token).post('/me/verification/challenge').expect(403);
    await e2e.as(staff.token).get('/me/verification').expect(403);
    await e2e.as(staff.token).get('/admin/verifications').expect(403);
    await e2e.as(staff.token).post(`/admin/verifications/${randomUUID()}/decide`).send({ decision: 'APPROVE' }).expect(403);

    // The grants that used to open the queue to gym staff open nothing now (ADR-0018).
    for (const role of ['ADMIN', 'FRONT_DESK'] as const) {
      const legacy = await gymStaff(`v-legacy-${role.toLowerCase()}`, role, tenant, legacyGrants);
      await e2e.as(legacy.token).get('/admin/verifications').expect(403);
      await e2e.as(legacy.token).get(`/admin/verifications/${randomUUID()}/selfie?expires=1&signature=${'A'.repeat(43)}`).expect(403);
      await e2e.as(legacy.token).post(`/admin/verifications/${randomUUID()}/decide`).send({ decision: 'REJECT', reason: 'OTHER' }).expect(403);
    }

    await e2e.as(lone.token).get('/admin/verifications').expect(403);
    await e2e.as(lone.token).post(`/admin/verifications/${randomUUID()}/decide`).send({ decision: 'APPROVE' }).expect(403);
    await e2e.as(lone.token).post('/me/verification/not-a-uuid/selfie').expect(400);
    await e2e.as(lone.token).post(`/me/verification/${randomUUID()}/selfie`).expect(404);

    const mod = await registerModerator(e2e, 'v-mod3');
    await e2e.as(mod.token).get('/me/verification').expect(403);
    await e2e.as(mod.token).post(`/admin/verifications/${randomUUID()}/decide`).send({ decision: 'APPROVE', comparedPhotoIds: [randomUUID()] }).expect(404);
    await e2e.as('invalid-token').get('/me/verification').expect(401);
  });
});
