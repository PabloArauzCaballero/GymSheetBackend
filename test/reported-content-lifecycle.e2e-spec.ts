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

      await purge.purgeExpired(1000, now);
      expect(await rowCount('profile.stories', reported.id)).toBe(1);
      expect(fileAt(reported.key)).toBe(true);
      expect(await rowCount('profile.stories', plain.id)).toBe(0);
      expect(fileAt(plain.key)).toBe(false);

      await closeReports('STORY', reported.id, now);
      await purge.purgeExpired(1000, now);
      expect(await rowCount('profile.stories', reported.id)).toBe(0);
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
});
