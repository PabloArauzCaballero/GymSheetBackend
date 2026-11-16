import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { env } from '../src/config/env';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_CONTENT_SHA256 } from '../src/modules/legal/legal-documents';
import { MediaReferencesRepository } from '../src/modules/media/media-references.repository';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { TicketLedgerRepository } from '../src/modules/antibot/ticket-ledger.repository';
import { ReportedContentRetentionService } from '../src/modules/account/reported-content-retention.service';
import { PrivacyRetentionRepository } from '../src/modules/privacy/privacy-retention.repository';
import { PrivacyRetentionService } from '../src/modules/privacy/privacy-retention.service';
import { VerificationRepository } from '../src/modules/verification/verification.repository';
import { VerificationRetentionService } from '../src/modules/verification/verification-retention.service';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';
import { openConversation, selectRows, selectRowsEventually } from './support/privacy-e2e';

/**
 * IP minimisation, retention, accepted-text hash and blob deletion (ADR-0014).
 * Runs with an IP hash secret and an isolated local media root.
 */
describe('Privacy retention and minimisation (e2e)', () => {
  let e2e: E2eApp;
  let mediaRoot: string;
  const secret = 'e2e-privacy-ip-hash-secret-0123456789abcdef';
  const config = env as { IP_HASH_SECRET?: string; MEDIA_STORAGE_PROVIDER: string; MEDIA_STORAGE_LOCAL_ROOT: string };
  const original = { ...config };
  const hmac = (ip: string) => createHmac('sha256', secret).update(ip).digest('hex');

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'gymsheet-privacy-media-'));
    config.IP_HASH_SECRET = secret;
    config.MEDIA_STORAGE_PROVIDER = 'local';
    config.MEDIA_STORAGE_LOCAL_ROOT = mediaRoot;
    e2e = await bootE2eApp();
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
    Object.assign(config, original);
    if (original.IP_HASH_SECRET === undefined) delete config.IP_HASH_SECRET;
    await rm(mediaRoot, { recursive: true, force: true });
  });
  afterEach(() => jest.restoreAllMocks());

  it('stores only the IP HMAC for password resets and admin audit entries', async () => {
    const member = await e2e.register('privacy-reset');
    const [account] = await selectRows<{ email: string }>(e2e, 'SELECT email FROM public.usuarios WHERE id = :id', { id: member.id });
    await request(e2e.http).post(e2e.url('/auth/password-reset/request')).send({ email: account.email }).expect(202);
    const resets = await selectRows<{ ip_hmac: string | null }>(
      e2e, 'SELECT ip_hmac FROM public.password_reset_tokens WHERE usuario_id = :id', { id: member.id });
    expect(resets).toHaveLength(1);
    expect(resets[0].ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(await selectRows(e2e, `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'password_reset_tokens' AND column_name = 'solicitado_desde_ip'`)).toEqual([]);

    const admin = await e2e.register('privacy-admin');
    await e2e.promote(admin.id, 'SYSTEM_ADMIN');
    const exercise = await createPersonalExercise(e2e.as(member.token), `privacy ${Date.now()}`);
    const routine = await e2e.as(member.token).post('/routines')
      .send({ nombre: `privacy ${Date.now()}`, dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: exercise }] }] }).expect(201);
    const routineId = routine.body.data.id as string;
    await e2e.as(admin.token).del(`/admin/routines/${routineId}/official`).expect(200);
    // The audit row is written after the response; wait for it instead of racing it.
    const audits = await selectRowsEventually<{ ip_hmac: string | null }>(
      e2e, `SELECT ip_hmac FROM admin.audit_log WHERE actor_user_id = :id AND target_id = :routineId`,
      { id: admin.id, routineId });
    expect(audits).toHaveLength(1);
    expect(audits[0].ip_hmac).toBe(resets[0].ip_hmac);
    // Keyed hash of the loopback address supertest connects from, never the address itself.
    expect(['::ffff:127.0.0.1', '127.0.0.1', '::1'].map(hmac)).toContain(audits[0].ip_hmac);
  });

  it('nulls every IP hash older than 90 days, in every table', async () => {
    const { id } = await e2e.register('privacy-retention');
    // Fixed clock in the past: inserted rows are never future-dated for other suites sharing the DB.
    const now = new Date('2026-11-01T00:00:00.000Z');
    const old = new Date('2026-06-01T00:00:00.000Z');
    const recent = new Date('2026-10-25T00:00:00.000Z');
    const statements = (at: Date, tag: string) => [
      [`INSERT INTO auth.signup_audit (id, user_id, completed_at, channel, risk, ip_hmac, created_at)
        VALUES (:rid, :id, :at, 'WEB', 'LOW', :tag, :at)`],
      [`UPDATE auth.terms_acceptances SET ip_hmac = :tag, accepted_at = :at WHERE user_id = :id AND document = :document`],
      [`INSERT INTO auth.user_devices (user_id, installation_id, last_seen_at, last_ip_hmac) VALUES (:id, :rid, :at, :tag)`],
      [`INSERT INTO public.password_reset_tokens (usuario_id, pin_hash, expira_en, consumido_en, created_at, ip_hmac)
        VALUES (:id, 'x', :at, :at, :at, :tag)`],
      [`INSERT INTO admin.audit_log (id, actor_user_id, actor_email, actor_role, domain, action, occurred_at, ip_hmac)
        VALUES (:rid, :id, 'x@example.test', 'ADMIN', 'privacy', 'retention', :at, :tag)`],
      [`INSERT INTO training.routine_progress_download_audits (user_id, format, file_name, created_at, ip_hmac)
        VALUES (:id, 'CSV', 'x.csv', :at, :tag)`],
    ].map(([sql]) => ({ sql, at, tag }));
    for (const [index, entry] of [...statements(old, 'a'.repeat(64)), ...statements(recent, 'b'.repeat(64))].entries()) {
      await e2e.sql(entry.sql, {
        id, rid: randomUUID(), at: entry.at, tag: entry.tag, document: index < 6 ? 'TERMS' : 'PRIVACY',
      });
    }

    // Verification selfies are a step of the same pass: one decided 61 days before `now`, one abandoned challenge,
    // and (another member) one waiting for review 47 days, past the 30-day review deadline.
    const [decidedId, abandonedId, overdueId] = [randomUUID(), randomUUID(), randomUUID()];
    const reviewed = await e2e.register('privacy-retention-review');
    const overdueKey = `users/${reviewed.id}/verificaciones/${randomUUID()}.jpg`;
    mkdirSync(dirname(join(mediaRoot, overdueKey)), { recursive: true });
    writeFileSync(join(mediaRoot, overdueKey), 'ciphertext');
    await e2e.sql(
      `INSERT INTO social.photo_verifications (id, user_id, gesture_code, challenge_issued_at, challenge_expires_at,
              selfie_storage_key, selfie_mime_type, status, submitted_at, created_at)
       VALUES (:overdueId, :userId, 'OPEN_PALM', '2026-09-15T00:00:00Z', '2026-09-15T00:10:00Z', :overdueKey, 'image/jpeg',
               'PENDING_REVIEW', '2026-09-15T00:05:00Z', '2026-09-15T00:00:00Z')`,
      { overdueId, userId: reviewed.id, overdueKey });
    const selfieKey = `users/${id}/verificaciones/${randomUUID()}.jpg`;
    mkdirSync(dirname(join(mediaRoot, selfieKey)), { recursive: true });
    writeFileSync(join(mediaRoot, selfieKey), 'ciphertext');
    await e2e.sql(
      `INSERT INTO social.photo_verifications (id, user_id, gesture_code, challenge_issued_at, challenge_expires_at,
              selfie_storage_key, selfie_mime_type, status, decided_at, submitted_at, created_at)
       VALUES (:decidedId, :id, 'THUMB_UP', '2026-09-01T00:00:00Z', '2026-09-01T00:10:00Z', :selfieKey, 'image/jpeg',
               'APPROVED', '2026-09-01T01:00:00Z', '2026-09-01T00:05:00Z', '2026-09-01T00:00:00Z'),
              (:abandonedId, :id, 'PEACE_SIGN', '2026-10-20T00:00:00Z', '2026-10-20T00:10:00Z', NULL, NULL,
               'PENDING_UPLOAD', NULL, NULL, '2026-10-20T00:00:00Z')`,
      { decidedId, abandonedId, id, selfieKey });

    // Built on the app connection: a second Nest context would rebind the global models.
    const mediaRelease = e2e.app.get(MediaReleaseService, { strict: false });
    const retention = new PrivacyRetentionService(
      e2e.app.get(TicketLedgerRepository, { strict: false }),
      new PrivacyRetentionRepository(e2e.app.get(Sequelize)),
      new ReportedContentRetentionService(
        e2e.app.get(Sequelize),
        e2e.app.get(MediaReferencesRepository, { strict: false }),
        mediaRelease,
      ),
      new VerificationRetentionService(
        e2e.app.get(VerificationRepository, { strict: false }),
        mediaRelease,
        e2e.app.get(NotificationService, { strict: false }),
      ),
    );
    const result = await retention.purge(now);
    expect(result.ipHashesCleared).toBeGreaterThanOrEqual(6);
    expect(result.verification.expiredChallenges).toBeGreaterThanOrEqual(1);
    expect(result.verification.selfiesErased).toBeGreaterThanOrEqual(2);
    expect(result.verification.expiredReviews).toBeGreaterThanOrEqual(1);
    const overdue = await selectRows<{ status: string; key: string | null }>(e2e,
      'SELECT status, selfie_storage_key AS key FROM social.photo_verifications WHERE id = :overdueId', { overdueId });
    expect(overdue).toEqual([{ status: 'EXPIRED', key: null }]);
    const reviewNotice = await selectRows<{ subject: string }>(e2e,
      'SELECT subject FROM notifications.messages WHERE recipient_user_id = :userId AND deduplication_key = :key',
      { userId: reviewed.id, key: `verification.review-expired:${overdueId}` });
    expect(reviewNotice).toEqual([{ subject: 'Tu verificación venció sin revisión' }]);
    const verifications = await selectRows<{ id: string; status: string; key: string | null }>(e2e,
      `SELECT id, status, selfie_storage_key AS key FROM social.photo_verifications WHERE user_id = :id ORDER BY created_at`, { id });
    expect(verifications).toEqual([
      { id: decidedId, status: 'APPROVED', key: null },
      { id: abandonedId, status: 'EXPIRED', key: null },
    ]);
    expect(existsSync(join(mediaRoot, selfieKey))).toBe(true);
    await mediaRelease.drainOnce();
    expect(existsSync(join(mediaRoot, selfieKey))).toBe(false);
    expect(existsSync(join(mediaRoot, overdueKey))).toBe(false);

    const remaining = await selectRows<{ source: string; hash: string | null }>(e2e, `
      SELECT 'signup' AS source, ip_hmac AS hash FROM auth.signup_audit WHERE user_id = :id
      UNION ALL SELECT 'terms', ip_hmac FROM auth.terms_acceptances WHERE user_id = :id
      UNION ALL SELECT 'devices', last_ip_hmac FROM auth.user_devices WHERE user_id = :id
      UNION ALL SELECT 'reset', ip_hmac FROM public.password_reset_tokens WHERE usuario_id = :id
      UNION ALL SELECT 'admin', ip_hmac FROM admin.audit_log WHERE actor_user_id = :id
      UNION ALL SELECT 'download', ip_hmac FROM training.routine_progress_download_audits WHERE user_id = :id AND file_name = 'x.csv'`,
    { id });
    const sourcesWith = (hash: string | null) =>
      [...new Set(remaining.filter((row) => row.hash === hash).map((row) => row.source))].sort();
    const sources = ['admin', 'devices', 'download', 'reset', 'signup', 'terms'];
    expect(sourcesWith('a'.repeat(64))).toEqual([]);
    expect(sourcesWith('b'.repeat(64))).toEqual(sources);
    expect(sourcesWith(null)).toEqual(sources);
  });

  it('records the coach progress download with the IP HMAC and keeps no raw IP column', async () => {
    const coach = await e2e.register('privacy-download');
    await e2e.as(coach.token).post('/export/routine-progress').set('Accept', 'application/json')
      .send({ format: 'csv' }).expect(201);
    const audits = await selectRows<Record<string, unknown>>(e2e,
      'SELECT * FROM training.routine_progress_download_audits WHERE user_id = :id', { id: coach.id });
    expect(audits).toHaveLength(1);
    expect(audits[0]).not.toHaveProperty('ip');
    expect(['::ffff:127.0.0.1', '127.0.0.1', '::1'].map(hmac)).toContain(audits[0].ip_hmac);
    const rawColumns = await selectRows(e2e, `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'training' AND column_name = 'ip'
        AND table_name IN ('routine_progress_download_audits', 'v_audit_routine_progress_downloads')`);
    expect(rawColumns).toEqual([]);
  });

  it('stores the SHA-256 of the accepted text with the acceptance', async () => {
    const { token, id } = await e2e.register('privacy-hash');
    const hash = 'c'.repeat(64);
    jest.replaceProperty(LEGAL_DOCUMENTS, 'TERMS', '2099-02-02');
    jest.replaceProperty(LEGAL_DOCUMENT_CONTENT_SHA256, 'TERMS', hash);
    const current = await request(e2e.http).get(e2e.url('/legal/current')).expect(200);
    expect(current.body.data.documents).toContainEqual({ document: 'TERMS', version: '2099-02-02', contentSha256: hash });
    await e2e.as(token).post('/me/legal/accept').send({ acceptances: [{ document: 'TERMS', version: '2099-02-02' }] }).expect(200);
    const rows = await selectRows<{ content_sha256: string | null }>(e2e,
      `SELECT content_sha256 FROM auth.terms_acceptances WHERE user_id = :id AND version = '2099-02-02'`, { id });
    expect(rows).toEqual([{ content_sha256: hash }]);
  });

  it('deleting a chat message for everyone removes its stored encrypted blob', async () => {
    const audio = readFileSync(join(__dirname, '../src/modules/chat/fixtures/valid-audio.m4a'));
    const a = await e2e.register('privacy-blob-a');
    const b = await e2e.register('privacy-blob-b');
    const conversationId = await openConversation(e2e, a, b);
    const sent = await e2e.as(a.token).post(`/me/conversations/${conversationId}/messages/media`)
      .field('type', 'audio').attach('file', audio, { filename: 'v.m4a', contentType: 'audio/mp4' }).expect(201);
    const messageId = sent.body.data.id as string;
    const [stored] = await selectRows<{ media_key: string }>(e2e,
      'SELECT media_key FROM chat.messages WHERE id = :messageId', { messageId });
    const blob = join(mediaRoot, stored.media_key);
    expect(existsSync(blob)).toBe(true);

    await e2e.as(a.token).del(`/me/conversations/${conversationId}/messages/${messageId}?scope=EVERYONE`).expect(200);
    await expect(e2e.app.get(MediaReleaseService).drainOnce()).resolves.toBeGreaterThanOrEqual(1);
    expect(existsSync(blob)).toBe(false);
    const jobs = await selectRows<{ status: string }>(e2e,
      `SELECT status FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND aggregate_id = :messageId`, { messageId });
    expect(jobs).toEqual([{ status: 'COMPLETED' }]);
  });
});
