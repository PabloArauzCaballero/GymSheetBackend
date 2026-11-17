/* eslint-disable @typescript-eslint/no-unsafe-return -- supertest types response bodies as `any`; the helpers only forward them. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { env } from '../src/config/env';
import { businessKycMigration } from '../src/database/migrations/202611200501-business-kyc';
import { ImageModerationService } from '../src/modules/business-kyc/image-moderation/image-moderation.service';
import { KycRetentionService } from '../src/modules/business-kyc/kyc-retention.service';
import { mountLocalMedia } from '../src/modules/media/local-media-mount';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { KycBusiness, KycHarness, bootKycHarness, randomDigits } from './support/kyc-e2e';

type CheckRow = { code: string; outcome: string };

describe('business KYC: wizard, automatic approval and retention (e2e, franja 8b)', () => {
  let h: KycHarness;

  beforeAll(async () => {
    h = await bootKycHarness();
  }, 60000);

  afterAll(async () => h.close());

  const kycOf = async (owner: KycBusiness) => (await h.e2e.as(owner.token).get('/business/me/kyc').expect(200)).body.data;
  const submit = (owner: KycBusiness) => h.e2e.as(owner.token).post('/business/me/kyc/submit');
  const checksOf = (submissionId: string) =>
    h.select<CheckRow>('SELECT code, outcome FROM business.kyc_checks WHERE submission_id = :submissionId ORDER BY created_at, id', { submissionId });

  it('a person gets 403 on business/me/kyc and business/me/phone', async () => {
    const person = await h.e2e.register('kyc-person');
    for (const path of ['/business/me/kyc', '/business/me/kyc/submit', '/business/me/phone/verify/request']) {
      const response = path.endsWith('kyc') ? await h.e2e.as(person.token).get(path) : await h.e2e.as(person.token).post(path).send({});
      expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: 'ACCOUNT_KIND_NOT_ALLOWED' });
    }
  });

  it('the selfie challenge needs the KYC_SELFIE consent first (400 CONSENT_REQUIRED), versioned like the others', async () => {
    const owner = await h.business('kyc-consent');
    const refused = await h.e2e.as(owner.token).post('/business/me/kyc/selfie-challenge');
    expect([refused.status, refused.body.code, refused.body.details]).toEqual([400, 'CONSENT_REQUIRED', { kind: 'KYC_SELFIE' }]);
    const outdated = await h.e2e.as(owner.token).put('/business/me/kyc/consent').send({ granted: true, version: '2020-01-01' });
    expect([outdated.status, outdated.body.code]).toEqual([409, 'CONSENT_VERSION_OUTDATED']);
    const legal = await request(h.e2e.http).get(h.e2e.url('/legal/current?accountKind=BUSINESS')).expect(200);
    expect(legal.body.data.consents).toEqual([{ kind: 'KYC_SELFIE', version: '2026-11-16' }]);
    await h.e2e.as(owner.token).put('/business/me/kyc/consent').send({ granted: true, version: '2026-11-16' }).expect(200);
    const challenge = await h.e2e.as(owner.token).post('/business/me/kyc/selfie-challenge').expect(201);
    expect(challenge.body.data).toEqual({ code: expect.any(String), instruction: expect.any(String), expiresAt: expect.any(String) });
    // A selfie without a live challenge is refused; one is used once.
    await h.e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', 'SELFIE').attach('file', h.photo, 'selfie.jpg').expect(201);
    const again = await h.e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', 'SELFIE').attach('file', h.photo, 'selfie.jpg');
    expect([again.status, again.body.code]).toEqual([409, 'KYC_SELFIE_CHALLENGE_REQUIRED']);
    // Revoking the consent erases the stored selfie (ADR-0014 pattern).
    await h.e2e.as(owner.token).put('/business/me/kyc/consent').send({ granted: false }).expect(200);
    const [selfie] = await h.select<{ key: string | null; reason: string | null }>(
      `SELECT d.storage_key AS key, d.delete_reason AS reason FROM business.kyc_documents d
         JOIN business.kyc_submissions s ON s.id = d.submission_id WHERE s.account_id = :id AND d.kind = 'SELFIE'`,
      { id: owner.id },
    );
    expect(selfie).toEqual({ key: null, reason: 'USER_REQUEST' });
  });

  it('validates the legal data formats (no invented check digit) and the phone', async () => {
    const owner = await h.business('kyc-formats');
    const nit = await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ nit: '12AB' });
    expect([nit.status, nit.body.code, nit.body.details]).toEqual([422, 'KYC_FIELD_INVALID', { field: 'nit', reason: 'FORMAT' }]);
    const ci = await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ repCiNumber: '123' });
    expect([ci.status, ci.body.details]).toEqual([422, { field: 'repCiNumber', reason: 'FORMAT' }]);
    const notApplicable = await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ specialty: 'Crossfit' });
    expect(notApplicable.body.details).toEqual({ field: 'specialty', reason: 'NOT_APPLICABLE' });
    await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ unknown: 1 }).expect(400);
    const saved = await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ nit: '1020304059', repCiNumber: '1234567', repCiComplement: '1a' }).expect(200);
    expect(saved.body.data.fields).toMatchObject({ nitMasked: '•••••••059', repCiMasked: '••••567', repCiComplement: '1A' });
    const phone = await h.e2e.as(owner.token).post('/business/me/phone/verify/request').send({ phone: '21234567' });
    expect([phone.status, phone.body.code]).toEqual([400, 'PHONE_INVALID']);
  });

  it('phone OTP: wrong code 400 with attempts left, rate limit 429, a verified phone', async () => {
    const owner = await h.business('kyc-phone');
    const sent = await h.e2e.as(owner.token).post('/business/me/phone/verify/request').send({ phone: `+591 ${owner.phone}` }).expect(202);
    expect(sent.body.data).toEqual({ phoneMasked: expect.stringMatching(/^\+591 •+\d{3}$/u), codeSent: true, expiresAt: expect.any(String) });
    const tooSoon = await h.e2e.as(owner.token).post('/business/me/phone/verify/request').send({ phone: owner.phone });
    expect([tooSoon.status, tooSoon.body.code]).toEqual([429, 'PHONE_OTP_RATE_LIMITED']);
    const code = h.sender.codes.get(`+591${owner.phone}`)!;
    const wrong = await h.e2e.as(owner.token).post('/business/me/phone/verify/confirm').send({ code: code === '000000' ? '111111' : '000000' });
    expect([wrong.status, wrong.body.code, wrong.body.details]).toEqual([400, 'PHONE_OTP_INVALID', { attemptsLeft: 4 }]);
    const ok = await h.e2e.as(owner.token).post('/business/me/phone/verify/confirm').send({ code }).expect(200);
    expect(ok.body.data).toMatchObject({ verified: true });
    const [stored] = await h.select<{ enc: Buffer; hash: string }>(
      'SELECT phone_enc AS enc, code_hash AS hash FROM business.phone_verifications WHERE account_id = :id',
      { id: owner.id },
    );
    expect(stored.enc.includes(Buffer.from(owner.phone))).toBe(false);
    expect(stored.hash).not.toContain(code);
  });

  it('422 KYC_INCOMPLETE lists what the submit still needs', async () => {
    const owner = await h.business('kyc-incomplete');
    await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ repFullName: 'Ana' }).expect(200);
    const response = await submit(owner);
    expect([response.status, response.body.code]).toEqual([422, 'KYC_INCOMPLETE']);
    expect(response.body.details.missing).toEqual(['PHONE', 'REP_CI', 'LEGAL_NAME', 'NIT', 'ADDRESS', 'DOCUMENT_CI_FRONT', 'DOCUMENT_CI_BACK', 'DOCUMENT_SELFIE']);
    expect((await kycOf(owner)).missing).toEqual(response.body.details.missing);
  });

  it('a document is measured at upload: an unreadable photo comes back «retake», HEIC is refused', async () => {
    const owner = await h.business('kyc-readable');
    const sharp = (await import('sharp')).default;
    const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#777', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg().toBuffer();
    const response = await h.e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', 'CI_FRONT').attach('file', small, 'ci.jpg').expect(201);
    expect(response.body.data).toMatchObject({ kind: 'CI_FRONT', readable: false, readabilityCodes: ['TOO_SMALL'], width: 640, height: 480 });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    const refused = await h.e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', 'CI_BACK').attach('file', heic, { filename: 'ci.heic', contentType: 'image/heic' });
    expect([refused.status, refused.body.code]).toEqual([400, 'KYC_DOCUMENT_UNSUPPORTED']);
  });

  it('happy path: every check passes → AUTO_APPROVED in seconds, public listing «Nuevo», stored bytes are ciphertext', async () => {
    const durations: number[] = [];
    const owners: KycBusiness[] = [];
    for (let index = 0; index < 5; index += 1) {
      const owner = await h.ready(`kyc-happy${index}`);
      const started = Date.now();
      const response = await submit(owner);
      durations.push(Date.now() - started);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        submissionId: expect.any(String),
        status: 'AUTO_APPROVED',
        reviewDueAt: null,
        postReviewDueAt: expect.any(String),
        userFacingCodes: [],
        handle: owner.handle,
      });
      owners.push(owner);
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    process.stdout.write(`kyc.submit durations ms=${JSON.stringify(durations)} p95=${p95}\n`);
    expect(Math.max(...durations)).toBeLessThan(3000);

    const owner = owners[0];
    const state = await kycOf(owner);
    expect(state).toMatchObject({ kycStatus: 'AUTO_APPROVED', accountStatus: 'ACTIVE', badge: 'NEW', missing: [] });
    const resolved = await request(h.e2e.http).get(h.e2e.url(`/public/handles/${owner.handle}`)).expect(200);
    expect(resolved.body.data.entity).toMatchObject({ id: owner.entityId, isVerified: false });
    const checks = await checksOf(state.submission.id);
    expect(checks.every((check) => check.outcome === 'PASS')).toBe(true);
    expect(checks).toHaveLength(11);
    const [history] = await h.select<{ transitions: string }>(
      `SELECT string_agg(from_status || '>' || to_status, ',' ORDER BY at, id) AS transitions FROM business.kyc_status_history WHERE submission_id = :id`,
      { id: state.submission.id },
    );
    expect(history.transitions).toBe('DRAFT>SUBMITTED,SUBMITTED>AUTO_APPROVED');
    const notices = await h.select<{ subject: string }>('SELECT subject FROM notifications.messages WHERE recipient_user_id = :id', { id: owner.id });
    expect(notices.map((row) => row.subject)).toContain('Tu negocio ya está publicado');

    // Stored file: GSKY1 ciphertext, never the JPEG.
    const [doc] = await h.select<{ key: string }>(
      `SELECT storage_key AS key FROM business.kyc_documents WHERE submission_id = :id AND kind = 'CI_FRONT'`,
      { id: state.submission.id },
    );
    expect(doc.key).toMatch(new RegExp(`^business/${owner.id}/kyc/${state.submission.id}/[0-9a-f-]{36}\\.bin$`, 'u'));
    const bytes = readFileSync(join(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), doc.key));
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('GSKY1');
    expect(bytes.includes(h.photo.subarray(0, 64))).toBe(false);

    // The logo is moderated asynchronously (Noop provider: left to the post-review).
    await h.e2e.app.get(ImageModerationService).drainOnce();
    expect((await checksOf(state.submission.id)).find((check) => check.code === 'IMAGE_MODERATION')).toEqual({ code: 'IMAGE_MODERATION', outcome: 'WARN' });
  }, 120000);

  it('a signup the anti-bot layer scored HIGH goes to review (ANTIBOT_RISK), with nothing to show the business', async () => {
    const owner = await h.business('kyc-risky', { risk: 'HIGH' });
    await h.verifyPhone(owner);
    await h.legal(owner, {});
    await h.documents(owner);
    const response = await submit(owner).expect(200);
    expect(response.body.data).toMatchObject({ status: 'IN_REVIEW', userFacingCodes: [] });
    const checks = await checksOf(response.body.data.submissionId as string);
    expect(checks.filter((check) => check.outcome !== 'PASS')).toEqual([{ code: 'ANTIBOT_RISK', outcome: 'FAIL' }]);
  });

  it('a stored KYC document is never served by the static media mount (404); public media still is', async () => {
    const owner = await h.ready('kyc-static');
    const [doc] = await h.select<{ key: string }>(
      `SELECT d.storage_key AS key FROM business.kyc_documents d JOIN business.kyc_submissions s ON s.id = d.submission_id
        WHERE s.account_id = :id AND d.storage_key IS NOT NULL LIMIT 1`,
      { id: owner.id },
    );
    expect(existsSync(join(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), doc.key))).toBe(true);
    const app = express();
    mountLocalMedia(app);
    const base = new URL(env.MEDIA_STORAGE_PUBLIC_BASE_URL).pathname;
    await request(app).get(`${base}/${doc.key}`).expect(404);
    await request(app).get(`${base}/${encodeURI(doc.key).replace('/kyc/', '/%6byc/')}`).expect(404);
    const me = await h.e2e.as(owner.token).get('/business/me').expect(200);
    const logoPath = new URL(me.body.data.entity.logoUrl as string).pathname;
    await request(app).get(logoPath).expect(200);
  });

  it('two concurrent submits with the same NIT: one AUTO_APPROVED, the other IN_REVIEW (DUPLICATE_NIT)', async () => {
    const nit = randomDigits(10);
    const first = await h.ready('kyc-dup-a', { nit });
    const second = await h.ready('kyc-dup-b', { nit });
    const responses = await Promise.all([submit(first), submit(second)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.data.status).sort()).toEqual(['AUTO_APPROVED', 'IN_REVIEW']);
    const review = responses.find((response) => response.body.data.status === 'IN_REVIEW')!;
    expect(review.body.data.userFacingCodes).toEqual(['DUPLICATE_NIT']);
    expect(review.body.data.reviewDueAt).toEqual(expect.any(String));
    const checks = await checksOf(review.body.data.submissionId as string);
    expect(checks.filter((check) => check.outcome !== 'PASS')).toEqual([{ code: 'DUPLICATE_NIT', outcome: 'FAIL' }]);
  }, 60000);

  it('without a phone OTP provider the phone stays unverified and the submit goes to review, never approval', async () => {
    const owner = await h.business('kyc-nophone');
    h.sender.available = false;
    try {
      const response = await h.e2e.as(owner.token).post('/business/me/phone/verify/request').send({ phone: owner.phone }).expect(202);
      expect(response.body.data).toMatchObject({ codeSent: false, expiresAt: null });
      const confirm = await h.e2e.as(owner.token).post('/business/me/phone/verify/confirm').send({ code: '123456' });
      expect([confirm.status, confirm.body.code]).toEqual([503, 'PHONE_OTP_UNAVAILABLE']);
    } finally {
      h.sender.available = true;
    }
    await h.legal(owner, {});
    await h.documents(owner);
    const submitted = await submit(owner).expect(200);
    expect(submitted.body.data).toMatchObject({ status: 'IN_REVIEW', userFacingCodes: ['PHONE_VERIFIED'] });
    const listing = await h.select<{ status: string }>('SELECT status FROM directory.entities WHERE id = :id', { id: owner.entityId });
    expect(listing).toEqual([{ status: 'DRAFT' }]);
    // What REPP reviews does not change under it.
    const locked = await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ address: 'Otra' });
    expect([locked.status, locked.body.code, locked.body.details]).toEqual([409, 'KYC_NOT_EDITABLE', { action: 'WAIT' }]);
    const handle = await h.e2e.as(owner.token).put('/business/me/handle').send({ handle: `${owner.handle}x` });
    expect([handle.status, handle.body.code]).toEqual([409, 'KYC_NOT_EDITABLE']);
  });

  it('retention: the documents of a rejected attempt are erased after 30 days and their files deleted', async () => {
    const owner = await h.ready('kyc-retention');
    const { submissionId } = (await submit(owner).expect(200)).body.data;
    await h.e2e.sql(
      `UPDATE business.kyc_submissions SET status = 'REJECTED', decided_at = now() - interval '31 days', allow_resubmit = false WHERE id = :submissionId`,
      { submissionId },
    );
    const keys = (await h.select<{ key: string }>('SELECT storage_key AS key FROM business.kyc_documents WHERE submission_id = :submissionId', { submissionId })).map((row) => row.key);
    expect(keys).toHaveLength(3);
    const result = await new KycRetentionService(h.sequelize, h.e2e.app.get(MediaReleaseService, { strict: false })).purge(new Date());
    expect(result.documentsErased.REJECTED).toBeGreaterThanOrEqual(3);
    expect(result.identitiesErased).toBeGreaterThanOrEqual(1);
    const rows = await h.select<{ key: string | null; reason: string }>(
      'SELECT storage_key AS key, delete_reason AS reason FROM business.kyc_documents WHERE submission_id = :submissionId',
      { submissionId },
    );
    expect(rows.every((row) => row.key === null && row.reason === 'RETENTION')).toBe(true);
    const [identity] = await h.select<{ nit: Buffer | null; hmac: string | null }>(
      'SELECT nit_enc AS nit, nit_hmac AS hmac FROM business.kyc_submissions WHERE id = :submissionId',
      { submissionId },
    );
    expect(identity.nit).toBeNull();
    expect(identity.hmac).toMatch(/^[0-9a-f]{64}$/u);
    const release = h.e2e.app.get(MediaReleaseService, { strict: false });
    for (let pass = 0; pass < 5 && keys.some((key) => existsSync(join(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), key))); pass += 1) await release.drainOnce(200);
    for (const key of keys) expect(existsSync(join(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), key))).toBe(false);
  }, 60000);

  it('migration 202611200501 goes down and up again (inside a transaction that is rolled back)', async () => {
    const owner = await h.ready('kyc-migration');
    await submit(owner).expect(200);
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    const tables = async () =>
      (
        await h.sequelize.query<{ submissions: string | null; column: string | null }>(
          `SELECT to_regclass('business.kyc_submissions')::text AS submissions,
                  (SELECT column_name::text FROM information_schema.columns
                    WHERE table_schema = 'business' AND table_name = 'accounts' AND column_name = 'current_submission_id') AS column`,
          { type: QueryTypes.SELECT, transaction },
        )
      )[0];
    try {
      await businessKycMigration.down(queryInterface, transaction);
      expect(await tables()).toEqual({ submissions: null, column: null });
      // Every stored file was queued for real deletion before the drop.
      const [jobs] = await h.sequelize.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND aggregate_type = 'business.kyc_documents'
            AND payload->>'storageKey' LIKE :prefix`,
        { type: QueryTypes.SELECT, replacements: { prefix: `business/${owner.id}/kyc/%` }, transaction },
      );
      expect(jobs.count).toBe(3);
      await businessKycMigration.up(queryInterface, transaction);
      expect(await tables()).toEqual({ submissions: 'business.kyc_submissions', column: 'current_submission_id' });
      await businessKycMigration.down(queryInterface, transaction);
      await businessKycMigration.up(queryInterface, transaction);
    } finally {
      await transaction.rollback();
    }
    expect((await kycOf(owner)).kycStatus).toBe('AUTO_APPROVED');
  });
});
