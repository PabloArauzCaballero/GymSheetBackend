import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { ReportedContentRetentionService } from '../src/modules/account/reported-content-retention.service';
import { ChatDisappearingPurgeService } from '../src/modules/chat/chat-disappearing-purge.service';
import { MediaReferencesRepository } from '../src/modules/media/media-references.repository';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { REPORT_EVIDENCE_RETENTION_DAYS } from '../src/modules/moderation/moderation.policy';
import { StoriesPurgeService } from '../src/modules/stories/stories-purge.service';
import { writeStoredFile } from './support/account-fixtures';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { selectRows } from './support/privacy-e2e';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What happens to a file and its row once the content is reported, deleted or
 * kept at closure: stories under an open report survive the 24 h purge (#27),
 * deleted comments and purged disappearing messages release their file (N5),
 * and content kept at closure because of a report goes 180 days after its last
 * report closed (N4). Fixed clocks; isolated local media root.
 */
describe('Reported content lifecycle (e2e)', () => {
  let e2e: E2eApp;
  let mediaRoot: string;
  const config = env as { MEDIA_STORAGE_PROVIDER: string; MEDIA_STORAGE_LOCAL_ROOT: string };
  const original = { ...config };

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'gymsheet-reported-media-'));
    config.MEDIA_STORAGE_PROVIDER = 'local';
    config.MEDIA_STORAGE_LOCAL_ROOT = mediaRoot;
    e2e = await bootE2eApp();
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
    Object.assign(config, original);
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const fileAt = (key: string) => existsSync(join(mediaRoot, key));
  const rowCount = async (table: string, id: string) =>
    (await selectRows(e2e, `SELECT 1 FROM ${table} WHERE id = :id`, { id })).length;
  const releaseJobs = (aggregateId: string) =>
    selectRows<{ status: string }>(e2e,
      `SELECT status FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND aggregate_id = :aggregateId`, { aggregateId });
  const fileReport = (reporterId: string, reportedId: string, kind: string, targetId: string) =>
    e2e.sql(`INSERT INTO moderation.reports (id, tenant_id, reporter_user_id, reported_user_id, target_kind, target_id, reason)
             VALUES (:id, 'default', :reporterId, :reportedId, :kind, :targetId, 'SPAM')`,
    { id: randomUUID(), reporterId, reportedId, kind, targetId });
  const closeReports = (kind: string, targetId: string, resolvedAt: Date) =>
    e2e.sql(`UPDATE moderation.reports SET status = 'RESUELTO', resolution = 'SIN_ACCION', resolved_at = :resolvedAt
              WHERE target_kind = :kind AND target_id = :targetId`, { kind, targetId, resolvedAt });

  describe('stories purge (#27)', () => {
    it('keeps an expired story and its file while a report on it is open, then purges it', async () => {
      const owner = await e2e.register('story-owner');
      const reporter = await e2e.register('story-reporter');
      // Fixed clock in the past, so live stories of other suites are never touched.
      const expiresAt = new Date('2026-01-01T00:00:00.000Z');
      const now = new Date('2026-01-01T00:00:01.000Z');
      const story = async () => {
        const id = randomUUID();
        const key = `users/${owner.id}/stories/${id}.jpg`;
        writeStoredFile(key);
        await e2e.sql(`INSERT INTO profile.stories (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
                       VALUES (:id, :userId, 'default', :url, 'local', :key, 'image', :expiresAt)`,
        { id, userId: owner.id, url: `${env.MEDIA_STORAGE_PUBLIC_BASE_URL}/${key}`, key, expiresAt });
        return { id, key };
      };
      const reported = await story();
      const plain = await story();
      await fileReport(reporter.id, owner.id, 'STORY', reported.id);
      const purge = e2e.app.get(StoriesPurgeService, { strict: false });

      const media = e2e.app.get(MediaReleaseService, { strict: false });

      await purge.purgeExpired(1000, now);
      expect(await rowCount('profile.stories', reported.id)).toBe(1);
      expect(await releaseJobs(reported.id)).toEqual([]);
      expect(await rowCount('profile.stories', plain.id)).toBe(0);
      // The purge queues the file on media.release with the row deletion (ADR-0017 §4).
      expect(await releaseJobs(plain.id)).toEqual([{ status: 'PENDING' }]);
      await media.drainOnce(500);
      expect(fileAt(reported.key)).toBe(true);
      expect(fileAt(plain.key)).toBe(false);

      await closeReports('STORY', reported.id, now);
      await purge.purgeExpired(1000, now);
      expect(await rowCount('profile.stories', reported.id)).toBe(0);
      await media.drainOnce(500);
      expect(fileAt(reported.key)).toBe(false);
    });
  });

  describe('deleted content releases its file (N5)', () => {
    it('a comment deleted by its author releases its attachment, unless another comment still uses it', async () => {
      const author = await e2e.register('comment-author');
      const routineId = randomUUID();
      await e2e.sql(`INSERT INTO training.routines (id, nombre, created_by_user_id)
                     VALUES (:routineId, 'Rutina con adjuntos', :userId)`, { routineId, userId: author.id });
      const comment = async (key: string) => {
        const id = randomUUID();
        await e2e.sql(`INSERT INTO community.content_comments (id, target_kind, target_id, autor_id, texto, adjunto_tipo, adjunto_url)
                       VALUES (:id, 'ROUTINE', :routineId, :userId, 'Con foto', 'IMAGEN', :url)`,
        { id, routineId, userId: author.id, url: `${env.MEDIA_STORAGE_PUBLIC_BASE_URL}/${key}` });
        return id;
      };
      const ownKey = `users/${author.id}/publicaciones/${randomUUID()}.jpg`;
      const sharedKey = `users/${author.id}/publicaciones/${randomUUID()}.jpg`;
      writeStoredFile(ownKey);
      writeStoredFile(sharedKey);
      const lone = await comment(ownKey);
      const first = await comment(sharedKey);
      await comment(sharedKey);

      await e2e.as(author.token).del(`/comments/${lone}`).expect(200);
      await e2e.as(author.token).del(`/comments/${first}`).expect(200);
      const [wiped] = await selectRows<{ estado: string; adjunto_url: string | null }>(e2e,
        'SELECT estado, adjunto_url FROM community.content_comments WHERE id = :id', { id: lone });
      expect(wiped).toEqual({ estado: 'BORRADO_AUTOR', adjunto_url: null });
      expect(await releaseJobs(lone)).toHaveLength(1);
      expect(await releaseJobs(first)).toEqual([]);

      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(ownKey)).toBe(false);
      expect(fileAt(sharedKey)).toBe(true);
    });

    it("deleting a comment never releases another person's file through a traversal URL", async () => {
      const attacker = await e2e.register('comment-traversal-attacker');
      const victim = await e2e.register('comment-traversal-victim');
      const routineId = randomUUID();
      await e2e.sql(`INSERT INTO training.routines (id, nombre, created_by_user_id)
                     VALUES (:routineId, 'Rutina atacada', :userId)`, { routineId, userId: attacker.id });
      const victimKey = `users/${victim.id}/publicaciones/${randomUUID()}.jpg`;
      writeStoredFile(victimKey);
      const commentId = randomUUID();
      // The URL starts with the attacker's own folder and climbs into the victim's.
      const url = `${env.MEDIA_STORAGE_PUBLIC_BASE_URL}/users/${attacker.id}/publicaciones/../../${victim.id}/publicaciones/${victimKey.split('/').pop()}`;
      await e2e.sql(`INSERT INTO community.content_comments (id, target_kind, target_id, autor_id, texto, adjunto_tipo, adjunto_url)
                     VALUES (:id, 'ROUTINE', :routineId, :userId, 'Trampa', 'IMAGEN', :url)`,
      { id: commentId, routineId, userId: attacker.id, url });

      await e2e.as(attacker.token).del(`/comments/${commentId}`).expect(200);
      expect(await releaseJobs(commentId)).toEqual([]);
      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(victimKey)).toBe(true);
    });

    it('the disappearing-message purge releases the file of the messages it deletes', async () => {
      const sender = await e2e.register('vanish-media-sender');
      const other = await e2e.register('vanish-media-other');
      const conversationId = randomUUID();
      const messageId = randomUUID();
      const key = `users/${sender.id}/chats/${conversationId}/${randomUUID()}.bin`;
      writeStoredFile(key);
      await e2e.sql(`INSERT INTO chat.conversations (id) VALUES (:conversationId)`, { conversationId });
      await e2e.sql(`INSERT INTO chat.participants (conversation_id, user_id) VALUES (:conversationId, :a), (:conversationId, :b)`,
        { conversationId, a: sender.id, b: other.id });
      await e2e.sql(`INSERT INTO chat.messages (id, conversation_id, sender_id, type, media_key, media_provider, expires_at)
                     VALUES (:messageId, :conversationId, :senderId, 'image', :key, 'local', now() - interval '1 minute')`,
      { messageId, conversationId, senderId: sender.id, key });

      await e2e.app.get(ChatDisappearingPurgeService, { strict: false }).purgeOnce();
      expect(await rowCount('chat.messages', messageId)).toBe(0);
      expect(await releaseJobs(messageId)).toHaveLength(1);

      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(key)).toBe(false);
    });
  });

  describe('content kept at closure because of a report (N4)', () => {
    it('stays while a report is open or recently closed and goes 180 days after the last one closed', async () => {
      const closer = await e2e.register('reported-closer');
      const reporter = await e2e.register('reported-reporter');
      const ids = { photo: randomUUID(), reel: randomUUID(), comment: randomUUID(), reply: randomUUID(),
        lone: randomUUID(), openPhoto: randomUUID(), conversation: randomUUID(), message: randomUUID(), routine: randomUUID() };
      const keys = {
        photo: `users/${closer.id}/perfiles/${ids.photo}.jpg`,
        openPhoto: `users/${closer.id}/perfiles/${ids.openPhoto}.jpg`,
        reel: `users/${closer.id}/reels/${ids.reel}.mp4`,
        comment: `users/${closer.id}/publicaciones/${ids.comment}.jpg`,
        message: `users/${closer.id}/chats/${ids.conversation}/${ids.message}.bin`,
      };
      Object.values(keys).forEach(writeStoredFile);
      const url = (key: string) => `${env.MEDIA_STORAGE_PUBLIC_BASE_URL}/${key}`;
      for (const [statement, replacements] of [
        [`INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key) VALUES (:id, :userId, :url, 'local', :key)`,
          { id: ids.photo, url: url(keys.photo), key: keys.photo }],
        [`INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key) VALUES (:id, :userId, :url, 'local', :key)`,
          { id: ids.openPhoto, url: url(keys.openPhoto), key: keys.openPhoto }],
        [`INSERT INTO social.reels (id, user_id, tenant_id, storage_provider, storage_key, mime_type, duration_seconds)
          VALUES (:id, :userId, 'default', 'local', :key, 'video/mp4', 10)`, { id: ids.reel, key: keys.reel }],
        [`INSERT INTO training.routines (id, nombre, created_by_user_id) VALUES (:id, 'Rutina', :otherId)`, { id: ids.routine }],
        [`INSERT INTO community.content_comments (id, target_kind, target_id, autor_id, texto, adjunto_tipo, adjunto_url)
          VALUES (:id, 'ROUTINE', :routine, :userId, 'Denunciado', 'IMAGEN', :url)`, { id: ids.comment, routine: ids.routine, url: url(keys.comment) }],
        [`INSERT INTO community.content_comments (id, target_kind, target_id, autor_id, texto, respuesta_a)
          VALUES (:id, 'ROUTINE', :routine, :otherId, 'Respuesta ajena', :parent)`, { id: ids.reply, routine: ids.routine, parent: ids.comment }],
        [`INSERT INTO community.content_comments (id, target_kind, target_id, autor_id, texto)
          VALUES (:id, 'ROUTINE', :routine, :userId, 'Sin respuestas')`, { id: ids.lone, routine: ids.routine }],
        [`INSERT INTO chat.conversations (id) VALUES (:id)`, { id: ids.conversation }],
        [`INSERT INTO chat.participants (conversation_id, user_id) VALUES (:id, :userId), (:id, :otherId)`, { id: ids.conversation }],
        [`INSERT INTO chat.messages (id, conversation_id, sender_id, body, type, media_key, media_provider)
          VALUES (:id, :conversation, :userId, 'Denunciado', 'image', :key, 'local')`,
          { id: ids.message, conversation: ids.conversation, key: keys.message }],
      ] as const) {
        await e2e.sql(statement, { userId: closer.id, otherId: reporter.id, ...replacements });
      }
      const targets: [string, string][] = [['PROFILE_PHOTO', ids.photo], ['PROFILE_PHOTO', ids.openPhoto], ['REEL', ids.reel],
        ['COMMENT', ids.comment], ['COMMENT', ids.lone], ['CHAT_MESSAGE', ids.message]];
      for (const [kind, id] of targets) await fileReport(reporter.id, closer.id, kind, id);

      await e2e.as(closer.token).del('/me/account').send({ password: 'e2e-strong-password' }).expect(200);
      expect(await rowCount('profile.photos', ids.photo)).toBe(1);
      expect(await rowCount('social.reels', ids.reel)).toBe(1);

      const resolvedAt = new Date('2026-01-01T00:00:00.000Z');
      for (const [kind, id] of targets.filter(([, id]) => id !== ids.openPhoto)) await closeReports(kind, id, resolvedAt);
      const retention = new ReportedContentRetentionService(
        e2e.app.get(Sequelize),
        e2e.app.get(MediaReferencesRepository, { strict: false }),
        e2e.app.get(MediaReleaseService, { strict: false }),
      );

      await retention.purge(new Date(resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS - 1) * DAY_MS));
      expect(await rowCount('profile.photos', ids.photo)).toBe(1);
      expect(await rowCount('social.reels', ids.reel)).toBe(1);
      expect(await rowCount('community.content_comments', ids.lone)).toBe(1);

      const erased = await retention.purge(new Date(resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS + 1) * DAY_MS));
      expect(erased).toMatchObject({ PROFILE_PHOTO: 1, REEL: 1, COMMENT: 2, CHAT_MESSAGE: 1 });
      expect(await rowCount('profile.photos', ids.photo)).toBe(0);
      expect(await rowCount('social.reels', ids.reel)).toBe(0);
      expect(await rowCount('community.content_comments', ids.lone)).toBe(0);
      // A report still open keeps its content, whatever the clock says.
      expect(await rowCount('profile.photos', ids.openPhoto)).toBe(1);
      // A comment other people answered stays as «comentario borrado», so their replies keep their thread.
      const [comment] = await selectRows<{ estado: string; texto: string; adjunto_url: string | null }>(e2e,
        'SELECT estado, texto, adjunto_url FROM community.content_comments WHERE id = :id', { id: ids.comment });
      expect(comment).toEqual({ estado: 'BORRADO_AUTOR', texto: '', adjunto_url: null });
      expect(await rowCount('community.content_comments', ids.reply)).toBe(1);
      const [message] = await selectRows<{ body: string | null; media_key: string | null }>(e2e,
        'SELECT body, media_key FROM chat.messages WHERE id = :id', { id: ids.message });
      expect(message).toEqual({ body: null, media_key: null });

      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      for (const key of [keys.photo, keys.reel, keys.comment, keys.message]) expect([key, fileAt(key)]).toEqual([key, false]);
      expect(fileAt(keys.openPhoto)).toBe(true);
    });
  });

  describe('evidence hold of content its author deletes under an open report (I2)', () => {
    // Fixed clock far from the N4 test's, so neither purge touches the other's rows.
    const resolvedAt = new Date('2025-06-01T00:00:00.000Z');
    const afterRetention = new Date(resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS + 1) * DAY_MS);
    const retention = () => new ReportedContentRetentionService(
      e2e.app.get(Sequelize),
      e2e.app.get(MediaReferencesRepository, { strict: false }),
      e2e.app.get(MediaReleaseService, { strict: false }),
    );
    const url = (key: string) => `${env.MEDIA_STORAGE_PUBLIC_BASE_URL}/${key}`;

    it('a reported profile photo is hidden for everyone but kept with its file until 180 days after the report closes', async () => {
      const author = await e2e.register('hold-photo-author');
      const reporter = await e2e.register('hold-photo-reporter');
      const [held, plain] = [randomUUID(), randomUUID()];
      const keys = { held: `users/${author.id}/perfiles/${held}.jpg`, plain: `users/${author.id}/perfiles/${plain}.jpg` };
      for (const [id, key] of [[held, keys.held], [plain, keys.plain]]) {
        writeStoredFile(key);
        await e2e.sql(`INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key) VALUES (:id, :userId, :url, 'local', :key)`,
          { id, userId: author.id, url: url(key), key });
      }
      await fileReport(reporter.id, author.id, 'PROFILE_PHOTO', held);

      await e2e.as(author.token).del(`/me/photos/${held}`).expect(200);
      await e2e.as(author.token).del(`/me/photos/${plain}`).expect(200);

      // Gone for its author (list, second delete) and for everyone else; row and file stay.
      const gallery = await e2e.as(author.token).get('/me/photos').expect(200);
      expect(JSON.stringify(gallery.body.data)).not.toContain(held);
      await e2e.as(author.token).del(`/me/photos/${held}`).expect(404);
      const [row] = await selectRows<{ hidden: boolean; deleted: boolean }>(e2e,
        'SELECT hidden_at IS NOT NULL AS hidden, author_deleted_at IS NOT NULL AS deleted FROM profile.photos WHERE id = :id', { id: held });
      expect(row).toEqual({ hidden: true, deleted: true });
      expect(await rowCount('profile.photos', plain)).toBe(0);
      // The plain photo's file is queued on media.release with its row deletion (ADR-0017 §4).
      expect(await releaseJobs(plain)).toEqual([{ status: 'PENDING' }]);
      expect(await releaseJobs(held)).toEqual([]);
      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(keys.held)).toBe(true);
      expect(fileAt(keys.plain)).toBe(false);

      // Closed but within the retention: still evidence.
      await closeReports('PROFILE_PHOTO', held, resolvedAt);
      await retention().purge(new Date(resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS - 1) * DAY_MS));
      expect(await rowCount('profile.photos', held)).toBe(1);

      await retention().purge(afterRetention);
      expect(await rowCount('profile.photos', held)).toBe(0);
      expect(await releaseJobs(held)).toHaveLength(1);
      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(keys.held)).toBe(false);
    });

    it("a moderator's restore never brings back a photo its author deleted", async () => {
      const author = await e2e.register('hold-restore-author');
      const reporter = await e2e.register('hold-restore-reporter');
      const moderator = await e2e.register('hold-restore-mod');
      await e2e.promote(moderator.id, 'SYSTEM_ADMIN');
      const photo = randomUUID();
      const key = `users/${author.id}/perfiles/${photo}.jpg`;
      writeStoredFile(key);
      await e2e.sql(`INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key) VALUES (:id, :userId, :url, 'local', :key)`,
        { id: photo, userId: author.id, url: url(key), key });
      await e2e.as(reporter.token).post('/me/reports').send({ targetKind: 'PROFILE_PHOTO', targetId: photo, reason: 'SPAM' }).expect(201);
      await e2e.as(author.token).del(`/me/photos/${photo}`).expect(200);

      const base = `/admin/moderation/cases/PROFILE_PHOTO/${photo}`;
      await e2e.as(moderator.token).post(`${base}/claim`).expect(201);
      await e2e.as(moderator.token).post(`${base}/resolve`).send({ hideContent: false, sanction: false, confirmMinor: false }).expect(201);
      const [row] = await selectRows<{ hidden: boolean }>(e2e,
        'SELECT hidden_at IS NOT NULL AS hidden FROM profile.photos WHERE id = :id', { id: photo });
      expect(row).toEqual({ hidden: true });
      // A held photo cannot be reported again: it no longer exists for anyone.
      await e2e.as(reporter.token).post('/me/reports').send({ targetKind: 'PROFILE_PHOTO', targetId: photo, reason: 'ACOSO' }).expect(404);
    });

    it('a reported story is held hidden and the stories purge removes it once no report is open', async () => {
      const author = await e2e.register('hold-story-author');
      const reporter = await e2e.register('hold-story-reporter');
      const id = randomUUID();
      const key = `users/${author.id}/stories/${id}.jpg`;
      writeStoredFile(key);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await e2e.sql(`INSERT INTO profile.stories (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
                     VALUES (:id, :userId, 'default', :url, 'local', :key, 'image', :expiresAt)`,
      { id, userId: author.id, url: url(key), key, expiresAt });
      await fileReport(reporter.id, author.id, 'STORY', id);

      await e2e.as(author.token).del(`/me/stories/${id}`).expect(200);
      await e2e.as(author.token).get(`/me/stories/${id}/media`).expect(404);
      await e2e.as(author.token).del(`/me/stories/${id}`).expect(404);
      expect(await rowCount('profile.stories', id)).toBe(1);
      expect(fileAt(key)).toBe(true);

      const purge = e2e.app.get(StoriesPurgeService, { strict: false });
      const afterExpiry = new Date(expiresAt.getTime() + 1000);
      await purge.purgeExpired(1000, afterExpiry);
      expect(await rowCount('profile.stories', id)).toBe(1);
      await closeReports('STORY', id, new Date());
      await purge.purgeExpired(1000, afterExpiry);
      expect(await rowCount('profile.stories', id)).toBe(0);
      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(key)).toBe(false);
    });

    it('a reported comment keeps its text and attachment, hidden, and the retention then erases it and releases the file', async () => {
      const author = await e2e.register('hold-comment-author');
      const reporter = await e2e.register('hold-comment-reporter');
      const routineId = randomUUID();
      await e2e.sql(`INSERT INTO training.routines (id, nombre, created_by_user_id) VALUES (:routineId, 'Rutina evidencia', :userId)`,
        { routineId, userId: reporter.id });
      const id = randomUUID();
      const key = `users/${author.id}/publicaciones/${randomUUID()}.jpg`;
      writeStoredFile(key);
      await e2e.sql(`INSERT INTO community.content_comments (id, target_kind, target_id, autor_id, texto, adjunto_tipo, adjunto_url)
                     VALUES (:id, 'ROUTINE', :routineId, :userId, 'Texto denunciado', 'IMAGEN', :url)`,
      { id, routineId, userId: author.id, url: url(key) });
      await fileReport(reporter.id, author.id, 'COMMENT', id);

      await e2e.as(author.token).del(`/comments/${id}`).expect(200);
      const [held] = await selectRows<{ estado: string; texto: string; adjunto_url: string | null }>(e2e,
        'SELECT estado, texto, adjunto_url FROM community.content_comments WHERE id = :id', { id });
      expect(held).toEqual({ estado: 'BORRADO_AUTOR', texto: 'Texto denunciado', adjunto_url: url(key) });
      expect(await releaseJobs(id)).toEqual([]);
      const listing = await e2e.as(reporter.token).get(`/comments/ROUTINE/${routineId}`).expect(200);
      expect(JSON.stringify(listing.body)).not.toContain('Texto denunciado');

      await closeReports('COMMENT', id, resolvedAt);
      await retention().purge(afterRetention);
      expect(await rowCount('community.content_comments', id)).toBe(0);
      expect(await releaseJobs(id)).toHaveLength(1);
      await e2e.app.get(MediaReleaseService, { strict: false }).drainOnce(500);
      expect(fileAt(key)).toBe(false);
    });
  });
});
