import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { ReportedContentRetentionService } from '../src/modules/account/reported-content-retention.service';
import { MediaReferencesRepository } from '../src/modules/media/media-references.repository';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { REPORT_EVIDENCE_RETENTION_DAYS } from '../src/modules/moderation/moderation.policy';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../src/modules/media/media-storage.port';
import { writeStoredFile } from './support/account-fixtures';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';
import { selectRows } from './support/privacy-e2e';

const PASSWORD = 'e2e-strong-password';
const DAY_MS = 24 * 60 * 60 * 1000;
// 1x1 PNG: the smallest multipart that is still a real image.
const tinyPng = (seed: string) => Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  // Trailing bytes after IEND keep the image valid and give each upload its own content key.
  Buffer.from(seed),
]);

/**
 * ADR-0017 follow-up. N11: a member's upload to their PERSONAL exercise is
 * their content, stored under their own folder and released with the media
 * row, the exercise and the account; catalog uploads stay immutable. N12: the
 * synchronous deletions (profile photo, story) queue the file on
 * `media.release` in the transaction that clears the row, so a storage outage
 * no longer fails the request and the removal is retried.
 */
describe('User media release (e2e)', () => {
  let e2e: E2eApp;
  let mediaRoot: string;
  let storage: MediaStorageProvider;
  let media: MediaReleaseService;
  const config = env as { MEDIA_STORAGE_PROVIDER: string; MEDIA_STORAGE_LOCAL_ROOT: string };
  const original = { ...config };

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'gymsheet-user-media-'));
    config.MEDIA_STORAGE_PROVIDER = 'local';
    config.MEDIA_STORAGE_LOCAL_ROOT = mediaRoot;
    e2e = await bootE2eApp();
    storage = e2e.app.get<MediaStorageProvider>(MEDIA_STORAGE_PROVIDER, { strict: false });
    media = e2e.app.get(MediaReleaseService, { strict: false });
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
    Object.assign(config, original);
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const base = () => env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/u, '');
  const keyOf = (url: string) => url.slice(base().length + 1);
  const fileAt = (key: string) => existsSync(join(mediaRoot, key));
  const releaseJobs = (aggregateId: string) =>
    selectRows<{ status: string; attempt_count: number }>(e2e,
      `SELECT status, attempt_count FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND aggregate_id = :aggregateId`,
      { aggregateId });
  const makeDue = (aggregateId: string) =>
    e2e.sql(`UPDATE integration.outbox_jobs SET available_at = now() WHERE queue_name = 'media.release' AND aggregate_id = :aggregateId`,
      { aggregateId });
  const uploadExerciseMedia = async (token: string, exerciseId: string, seed: string) => {
    const response = await e2e.as(token)
      .post(`/exercises/${exerciseId}/media/upload`)
      .field('altText', 'Demostración del ejercicio')
      .attach('file', tinyPng(seed), { filename: 'demo.png', contentType: 'image/png' })
      .expect(201);
    return response.body.data as { id: string; url: string };
  };

  describe('personal exercise uploads (N11)', () => {
    it("are stored in the owner's folder and released when the media row is deleted", async () => {
      const owner = await e2e.register('pex-media-owner');
      const exerciseId = await createPersonalExercise(e2e.as(owner.token), 'Press propio con foto');

      const uploaded = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      const key = keyOf(uploaded.url);
      expect(key.startsWith(`users/${owner.id}/ejercicios/${exerciseId}/`)).toBe(true);
      expect(fileAt(key)).toBe(true);

      const stranger = await e2e.register('pex-media-stranger');
      await e2e.as(stranger.token).del(`/exercise-media/${uploaded.id}`).expect(403);
      expect(fileAt(key)).toBe(true);

      await e2e.as(owner.token).del(`/exercise-media/${uploaded.id}`).expect(200);
      expect(await selectRows(e2e, 'SELECT 1 FROM training.exercise_media WHERE id = :id', { id: uploaded.id })).toEqual([]);
      expect(await releaseJobs(uploaded.id)).toEqual([{ status: 'PENDING', attempt_count: 0 }]);
      await media.drainOnce(500);
      expect(fileAt(key)).toBe(false);
    });

    it('release the replaced file on a re-upload, and the rest when the personal exercise is deleted', async () => {
      const owner = await e2e.register('pex-delete-owner');
      const exerciseId = await createPersonalExercise(e2e.as(owner.token), 'Remo propio con foto');
      const first = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      // Same identity (exercise, variant, format, version), new content: the row moves to the new object.
      const second = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      expect(second.id).toBe(first.id);
      expect(await releaseJobs(first.id)).toEqual([{ status: 'PENDING', attempt_count: 0 }]);
      await media.drainOnce(500);
      expect(fileAt(keyOf(first.url))).toBe(false);
      expect(fileAt(keyOf(second.url))).toBe(true);

      await e2e.as(owner.token).del(`/exercises/${exerciseId}`).expect(200);
      expect(await selectRows(e2e, 'SELECT 1 FROM training.exercise_media WHERE ejercicio_id = :exerciseId', { exerciseId })).toEqual([]);
      expect(await releaseJobs(exerciseId)).toEqual([{ status: 'PENDING', attempt_count: 0 }]);
      await media.drainOnce(500);
      expect(fileAt(keyOf(second.url))).toBe(false);
    });

    it('are released when the account closes', async () => {
      const owner = await e2e.register('pex-closure-owner');
      const exerciseId = await createPersonalExercise(e2e.as(owner.token), 'Curl propio con foto');
      const key = keyOf((await uploadExerciseMedia(owner.token, exerciseId, randomUUID())).url);

      const preview = await e2e.as(owner.token).get('/me/account/closure-preview').expect(200);
      expect((preview.body.data.deleted as { table: string }[]).map((item) => item.table)).toContain('training.exercise_media');
      await e2e.as(owner.token).del('/me/account').send({ password: PASSWORD }).expect(200);
      expect(await releaseJobs(owner.id)).toEqual(expect.arrayContaining([{ status: 'PENDING', attempt_count: 0 }]));
      await media.drainOnce(500);
      expect(fileAt(key)).toBe(false);
    });

    it('a catalog upload stays under the immutable ejercicios/ folder and its deletion only deactivates it', async () => {
      const admin = await e2e.register('pex-catalog-admin');
      await e2e.promote(admin.id, 'ADMIN');
      const created = await e2e.as(admin.token).post('/admin/exercises/global')
        .send({ nombre: `Sentadilla catálogo ${randomUUID().slice(0, 8)}`, grupoMuscular: 'Piernas' }).expect(201);
      const exerciseId = created.body.data.id as string;

      const uploaded = await uploadExerciseMedia(admin.token, exerciseId, randomUUID());
      const key = keyOf(uploaded.url);
      expect(key.startsWith(`ejercicios/${exerciseId}/`)).toBe(true);

      await e2e.as(admin.token).del(`/exercise-media/${uploaded.id}`).expect(200);
      expect(await selectRows(e2e, 'SELECT status FROM training.exercise_media WHERE id = :id', { id: uploaded.id }))
        .toEqual([{ status: 'INACTIVE' }]);
      expect(await releaseJobs(uploaded.id)).toEqual([]);
      expect(fileAt(key)).toBe(true);
    });
  });

  describe('personal exercise uploads under a report are evidence (ADR-0017 §7)', () => {
    const fileReport = (reporterId: string, reportedId: string, exerciseId: string) =>
      e2e.sql(`INSERT INTO moderation.reports (id, tenant_id, reporter_user_id, reported_user_id, target_kind, target_id, reason)
               VALUES (:id, 'default', :reporterId, :reportedId, 'EXERCISE', :exerciseId, 'SPAM')`,
      { id: randomUUID(), reporterId, reportedId, exerciseId });
    const resolvedAt = new Date('2026-01-01T00:00:00.000Z');
    const closeReports = (exerciseId: string) =>
      e2e.sql(`UPDATE moderation.reports SET status = 'RESUELTO', resolution = 'SIN_ACCION', resolved_at = :resolvedAt
                WHERE target_kind = 'EXERCISE' AND target_id = :exerciseId`, { exerciseId, resolvedAt });
    const purgeAfterRetention = () => new ReportedContentRetentionService(
      e2e.app.get(Sequelize),
      e2e.app.get(MediaReferencesRepository, { strict: false }),
      media,
    ).purge(new Date(resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS + 1) * DAY_MS));
    const mediaRows = (exerciseId: string) =>
      selectRows<{ id: string; status: string; held: boolean }>(e2e,
        `SELECT id, status, author_deleted_at IS NOT NULL AS held FROM training.exercise_media
          WHERE ejercicio_id = :exerciseId ORDER BY created_at`, { exerciseId });
    const addPoster = async (ownerId: string, exerciseId: string, mediaId: string) => {
      const posterKey = `users/${ownerId}/ejercicios/${exerciseId}/${randomUUID()}.webp`;
      writeStoredFile(posterKey);
      await e2e.sql('UPDATE training.exercise_media SET thumbnail_url = :url WHERE id = :mediaId',
        { url: `${base()}/${posterKey}`, mediaId });
      return posterKey;
    };

    it('deleting an upload of a reported exercise hides the row and keeps the file until the retention erases both', async () => {
      const owner = await e2e.register('pex-held-owner');
      const reporter = await e2e.register('pex-held-reporter');
      const exerciseId = await createPersonalExercise(e2e.as(owner.token), 'Press propio denunciado');
      const uploaded = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      const key = keyOf(uploaded.url);
      await fileReport(reporter.id, owner.id, exerciseId);

      await e2e.as(owner.token).del(`/exercise-media/${uploaded.id}`).expect(200);
      expect(await mediaRows(exerciseId)).toEqual([{ id: uploaded.id, status: 'INACTIVE', held: true }]);
      const listed = await e2e.as(owner.token).get(`/exercises/${exerciseId}/media`).expect(200);
      expect(JSON.stringify(listed.body.data)).not.toContain(uploaded.id);
      expect(await releaseJobs(uploaded.id)).toEqual([]);
      await media.drainOnce(500);
      expect(fileAt(key)).toBe(true);

      // A new upload with the same identity gets its own row: the held one is never revived nor replaced.
      const again = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      expect(again.id).not.toBe(uploaded.id);
      // Deleting the exercise holds that upload too while the report is open.
      await e2e.as(owner.token).del(`/exercises/${exerciseId}`).expect(200);
      expect(await mediaRows(exerciseId)).toEqual([
        { id: uploaded.id, status: 'INACTIVE', held: true },
        { id: again.id, status: 'INACTIVE', held: true },
      ]);
      expect(await releaseJobs(exerciseId)).toEqual([]);
      await media.drainOnce(500);
      expect(fileAt(key)).toBe(true);
      expect(fileAt(keyOf(again.url))).toBe(true);

      await closeReports(exerciseId);
      await purgeAfterRetention();
      expect(await mediaRows(exerciseId)).toEqual([]);
      await media.drainOnce(500);
      expect(fileAt(key)).toBe(false);
      expect(fileAt(keyOf(again.url))).toBe(false);
    });

    it('account closure releases the poster of an upload as well as its file', async () => {
      const owner = await e2e.register('pex-poster-owner');
      const exerciseId = await createPersonalExercise(e2e.as(owner.token), 'Curl propio con póster');
      const uploaded = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      const posterKey = await addPoster(owner.id, exerciseId, uploaded.id);

      await e2e.as(owner.token).del('/me/account').send({ password: PASSWORD }).expect(200);
      await media.drainOnce(500);
      expect(fileAt(keyOf(uploaded.url))).toBe(false);
      expect(fileAt(posterKey)).toBe(false);
    });

    it('account closure keeps a reported exercise and its uploads, and the retention erases them later', async () => {
      const owner = await e2e.register('pex-closure-reported');
      const reporter = await e2e.register('pex-closure-reporter');
      const exerciseId = await createPersonalExercise(e2e.as(owner.token), 'Remo propio denunciado');
      const uploaded = await uploadExerciseMedia(owner.token, exerciseId, randomUUID());
      const posterKey = await addPoster(owner.id, exerciseId, uploaded.id);
      await fileReport(reporter.id, owner.id, exerciseId);

      const preview = await e2e.as(owner.token).get('/me/account/closure-preview').expect(200);
      const kept = (preview.body.data.kept as { table: string }[]).map((item) => item.table);
      expect(kept).toEqual(expect.arrayContaining(['training.exercise_media', 'public.ejercicios']));
      await e2e.as(owner.token).del('/me/account').send({ password: PASSWORD }).expect(200);
      expect(await mediaRows(exerciseId)).toEqual([{ id: uploaded.id, status: 'ACTIVE', held: false }]);
      expect(await selectRows(e2e, 'SELECT 1 FROM public.ejercicios WHERE id = :exerciseId', { exerciseId })).toHaveLength(1);
      await media.drainOnce(500);
      expect(fileAt(keyOf(uploaded.url))).toBe(true);
      expect(fileAt(posterKey)).toBe(true);

      await closeReports(exerciseId);
      await purgeAfterRetention();
      expect(await mediaRows(exerciseId)).toEqual([]);
      expect(await selectRows(e2e, 'SELECT 1 FROM public.ejercicios WHERE id = :exerciseId', { exerciseId })).toEqual([]);
      await media.drainOnce(500);
      expect(fileAt(keyOf(uploaded.url))).toBe(false);
      expect(fileAt(posterKey)).toBe(false);
    });
  });

  describe('synchronous deletions go through the media.release outbox (N12)', () => {
    it('deleting a profile photo answers 200 while the storage fails, and the removal is retried', async () => {
      const owner = await e2e.register('photo-release-owner');
      const uploaded = await e2e.as(owner.token).post('/me/photos')
        .attach('file', tinyPng(randomUUID()), { filename: 'avatar.png', contentType: 'image/png' }).expect(201);
      const photoId = uploaded.body.data.id as string;
      const [{ key }] = await selectRows<{ key: string }>(e2e,
        'SELECT storage_key AS key FROM profile.photos WHERE id = :photoId', { photoId });
      expect(fileAt(key)).toBe(true);

      const outage = jest.spyOn(storage, 'remove')
        .mockRejectedValueOnce(Object.assign(new Error('Access Denied.'), { code: 'AccessDenied' }));
      try {
        await e2e.as(owner.token).del(`/me/photos/${photoId}`).expect(200);
        expect(outage).not.toHaveBeenCalled();
        expect(await selectRows(e2e, 'SELECT 1 FROM profile.photos WHERE id = :photoId', { photoId })).toEqual([]);

        await media.drainOnce(500);
        expect(outage).toHaveBeenCalledWith(key);
        expect(await releaseJobs(photoId)).toEqual([{ status: 'FAILED', attempt_count: 1 }]);
        expect(fileAt(key)).toBe(true);
      } finally {
        outage.mockRestore();
      }

      await makeDue(photoId);
      await media.drainOnce(500);
      expect(await releaseJobs(photoId)).toEqual([{ status: 'COMPLETED', attempt_count: 2 }]);
      expect(fileAt(key)).toBe(false);
    });

    it('a media.release job that dead-letters shows up on /health/metrics without anyone looking (I-2)', async () => {
      const deadLetters = async () => {
        const call = request(e2e.http).get(e2e.url('/health/metrics'));
        if (env.METRICS_SCRAPE_TOKEN) call.set('Authorization', `Bearer ${env.METRICS_SCRAPE_TOKEN}`);
        const text = (await call.expect(200)).text;
        const match = /^gym_sheet_outbox_dead_letter_jobs\{queue="media\.release"\} (\d+)$/mu.exec(text);
        expect(match).not.toBeNull();
        return Number(match?.[1]);
      };
      const before = await deadLetters();
      const owner = await e2e.register('photo-dead-letter-owner');
      const uploaded = await e2e.as(owner.token).post('/me/photos')
        .attach('file', tinyPng(randomUUID()), { filename: 'avatar.png', contentType: 'image/png' }).expect(201);
      const photoId = uploaded.body.data.id as string;
      const outage = jest.spyOn(storage, 'remove')
        .mockRejectedValue(Object.assign(new Error('Access Denied.'), { code: 'AccessDenied' }));
      try {
        await e2e.as(owner.token).del(`/me/photos/${photoId}`).expect(200);
        // One attempt left: the next failure is the last one.
        await e2e.sql(`UPDATE integration.outbox_jobs SET max_attempts = 1 WHERE queue_name = 'media.release' AND aggregate_id = :photoId`,
          { photoId });
        await media.drainOnce(500);
      } finally {
        outage.mockRestore();
      }
      expect(await releaseJobs(photoId)).toEqual([{ status: 'DEAD_LETTER', attempt_count: 1 }]);
      expect(await deadLetters()).toBe(before + 1);
    });

    it('deleting a story queues its file and the worker removes it', async () => {
      const author = await e2e.register('story-release-author');
      const id = randomUUID();
      const key = `users/${author.id}/stories/${id}.jpg`;
      writeStoredFile(key);
      await e2e.sql(`INSERT INTO profile.stories (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
                     VALUES (:id, :userId, 'default', :url, 'local', :key, 'image', now() + interval '1 hour')`,
      { id, userId: author.id, url: `${base()}/${key}`, key });

      await e2e.as(author.token).del(`/me/stories/${id}`).expect(200);
      expect(await releaseJobs(id)).toEqual([{ status: 'PENDING', attempt_count: 0 }]);
      expect(fileAt(key)).toBe(true);
      await media.drainOnce(500);
      expect(fileAt(key)).toBe(false);
    });
  });
});
