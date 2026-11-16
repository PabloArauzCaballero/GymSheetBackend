import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { bootE2eApp, type E2eApp } from './support/e2e-app';
import { grantConsent } from './support/privacy-e2e';

/**
 * The VERIFICATION_SELFIE consent (ADR-0014) against PostgreSQL: the person
 * verification needs an open grant of the current text, and revoking it
 * erases every stored selfie through the shared `media.release` queue while
 * the decision already taken stays.
 */
describe('Photo verification consent (e2e)', () => {
  jest.setTimeout(90000);
  let e2e: E2eApp;
  let sequelize: Sequelize;
  let mediaRelease: MediaReleaseService;
  const tenant = `verif-consent-${Date.now().toString(36)}`;
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  type Account = { token: string; id: string };
  type Attempt = { id: string; status: string; key: string | null; deleted: Date | null };

  async function member(label: string, consent = true): Promise<Account> {
    const account = await e2e.register(label);
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenant WHERE id = :id', { tenant, id: account.id });
    for (const position of [0, 1]) {
      await e2e.sql(
        `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key, position)
         VALUES (:id, 'http://localhost/p.jpg', 'local', :key, :position)`,
        { id: account.id, key: `verif-consent-e2e/${account.id}/${position}`, position },
      );
    }
    if (consent) await grantConsent(e2e, account.token, 'VERIFICATION_SELFIE');
    return account;
  }

  async function moderator(): Promise<Account> {
    const account = await e2e.register('vc-mod');
    await e2e.promote(account.id, 'ADMIN');
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenant WHERE id = :id', { tenant, id: account.id });
    for (const key of ['moderation:read', 'moderation:act']) {
      await e2e.sql(
        `INSERT INTO admin.permissions (key, label, description, domain) VALUES (:key, :key, 'e2e', 'moderation')
         ON CONFLICT (key) DO NOTHING`, { key });
      await e2e.sql('INSERT INTO admin.user_permissions (id, user_id, permission_key) VALUES (gen_random_uuid(), :id, :key)',
        { id: account.id, key });
    }
    return account;
  }

  const attempts = (userId: string) => sequelize.query<Attempt>(
    `SELECT id, status, selfie_storage_key AS key, selfie_deleted_at AS deleted
       FROM social.photo_verifications WHERE user_id = :userId ORDER BY created_at`,
    { type: QueryTypes.SELECT, replacements: { userId } });
  const upload = (account: Account, id: string) =>
    e2e.as(account.token).post(`/me/verification/${id}/selfie`).attach('file', JPEG, { filename: 's.jpg', contentType: 'image/jpeg' });
  const challenge = async (account: Account) =>
    (await e2e.as(account.token).post('/me/verification/challenge').expect(201)).body.data.id as string;
  const revoke = (account: Account) =>
    e2e.as(account.token).put('/me/consents/VERIFICATION_SELFIE').send({ granted: false }).expect(200);
  const expectConsentRequired = (body: { code: string; details: unknown }) =>
    expect(body).toMatchObject({ code: 'CONSENT_REQUIRED', details: { kind: 'VERIFICATION_SELFIE' } });

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    mediaRelease = e2e.app.get(MediaReleaseService, { strict: false });
    await e2e.sql('INSERT INTO tenants (id, nombre) VALUES (:id, :id)', { id: tenant });
  }, 60000);
  afterAll(async () => e2e?.app.close());

  it('answers 400 CONSENT_REQUIRED without a current grant, before a challenge or a selfie', async () => {
    const never = await member('vc-never', false);
    expectConsentRequired((await e2e.as(never.token).post('/me/verification/challenge').expect(400)).body);
    expect(await attempts(never.id)).toEqual([]);

    // A grant of an older text does not cover biometric data.
    const outdated = await member('vc-outdated');
    await e2e.sql(`UPDATE auth.consents SET version = '2000-01-01' WHERE user_id = :id AND kind = 'VERIFICATION_SELFIE'`,
      { id: outdated.id });
    expectConsentRequired((await e2e.as(outdated.token).post('/me/verification/challenge').expect(400)).body);

    // Revoked between challenge and upload: the challenge is cancelled and the selfie refused, nothing stored.
    const late = await member('vc-late');
    const id = await challenge(late);
    await revoke(late);
    expectConsentRequired((await upload(late, id).expect(400)).body);
    expect(await attempts(late.id)).toEqual([{ id, status: 'EXPIRED', key: null, deleted: null }]);

    // Granting again opens the flow.
    await grantConsent(e2e, never.token, 'VERIFICATION_SELFIE');
    await e2e.as(never.token).post('/me/verification/challenge').expect(201);
  });

  it('revoking erases every stored selfie through media.release, cancels pending attempts and keeps the decision', async () => {
    const eva = await member('vc-eva');
    const fio = await member('vc-fio');
    const mod = await moderator();
    const approvedId = await challenge(eva);
    await upload(eva, approvedId).expect(201);
    const queue = (await e2e.as(mod.token).get('/admin/verifications?status=PENDING_REVIEW&limit=50').expect(200)).body.data;
    const item = queue.find((entry: { id: string }) => entry.id === approvedId) as { profilePhotos: { id: string }[] };
    const comparedPhotoIds = item.profilePhotos.map((photo) => photo.id);
    await e2e.as(mod.token).post(`/admin/verifications/${approvedId}/decide`).send({ decision: 'APPROVE', comparedPhotoIds }).expect(200);
    const pendingId = await challenge(fio);
    await upload(fio, pendingId).expect(201);
    const [approvedKey, pendingKey] = [String((await attempts(eva.id))[0].key), String((await attempts(fio.id))[0].key)];
    const [approvedPath, pendingPath] = [approvedKey, pendingKey].map((key) => join(env.MEDIA_STORAGE_LOCAL_ROOT, key));

    // The media worker never deletes a selfie a verification row still points at.
    await sequelize.transaction((transaction) => mediaRelease.requestRelease(
      { aggregateType: 'e2e.stray', aggregateId: approvedId, storageKey: approvedKey }, transaction));
    await mediaRelease.drainOnce();
    expect(existsSync(approvedPath)).toBe(true);

    for (const account of [eva, fio]) expect((await revoke(account)).body.data).toMatchObject({ granted: false });
    expect(await attempts(eva.id)).toEqual([{ id: approvedId, status: 'APPROVED', key: null, deleted: expect.any(Date) }]);
    expect(await attempts(fio.id)).toEqual([{ id: pendingId, status: 'EXPIRED', key: null, deleted: expect.any(Date) }]);
    const jobs = await sequelize.query(
      `SELECT 1 FROM integration.outbox_jobs WHERE queue_name = 'media.release'
          AND aggregate_type = 'social.photo_verifications' AND aggregate_id IN (:ids)`,
      { type: QueryTypes.SELECT, replacements: { ids: [approvedId, pendingId] } });
    expect(jobs).toHaveLength(2);
    await mediaRelease.drainOnce();
    expect(existsSync(approvedPath)).toBe(false);
    expect(existsSync(pendingPath)).toBe(false);

    // The decision is a fact: badge and record stay, the image is gone.
    expect((await e2e.as(eva.token).get('/me/verification').expect(200)).body.data).toMatchObject({
      status: 'APPROVED', verifiedAt: expect.any(String), lastDecision: { decision: 'APPROVED' },
    });
    expect((await e2e.as(eva.token).get('/users/me').expect(200)).body.data.verified).toBe(true);
    // The cancelled attempt left the queue and can no longer be decided.
    const late = await e2e.as(mod.token).post(`/admin/verifications/${pendingId}/decide`)
      .send({ decision: 'APPROVE', comparedPhotoIds }).expect(409);
    expect(late.body.code).toBe('VERIFICATION_CHALLENGE_EXPIRED');
    const after = (await e2e.as(mod.token).get('/admin/verifications?status=PENDING_REVIEW&limit=50').expect(200)).body.data;
    expect(after.map((entry: { id: string }) => entry.id)).not.toContain(pendingId);
  });
});
