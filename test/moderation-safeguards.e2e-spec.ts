import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Sequelize } from 'sequelize-typescript';
import { AccountClosureRepository } from '../src/modules/account/account-closure.repository';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { ChatDisappearingPurgeService } from '../src/modules/chat/chat-disappearing-purge.service';
import { ModerationEvidenceService } from '../src/modules/moderation/moderation-evidence.service';
import { REPORT_EVIDENCE_RETENTION_DAYS } from '../src/modules/moderation/moderation.policy';
import { MINOR_ACCOUNT_CLOSURE_QUEUE } from '../src/modules/moderation/moderation-minor.service';
import { writeStoredFile } from './support/account-fixtures';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';
import { connectChatSocket, emitWithAck, inbox, listen, Member, registerModerator, resolveCase } from './support/moderation-e2e';
import { openConversation, selectRows } from './support/privacy-e2e';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Promises of the legal texts about reports and sanctions, kept by the code (review-1 #1, #2, #4, #6, #7, #20). */
describe('Moderation safeguards (e2e)', () => {
  let e2e: E2eApp;
  let moderator: Member;
  let baseUrl: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    baseUrl = await listen(e2e);
    moderator = await registerModerator(e2e, 'safeguards-mod');
  }, 60000);
  afterAll(async () => e2e?.app.close());

  const report = (token: string, targetKind: string, targetId: string, reason: string) =>
    e2e.as(token).post('/me/reports').send({ targetKind, targetId, reason });
  const suspendedUntil = async (id: string) =>
    (await selectRows<{ until: Date | null }>(e2e, 'SELECT suspended_until AS until FROM public.usuarios WHERE id = :id', { id }))[0].until;

  describe('a report of a minor', () => {
    it('suspends the member once a second reporter corroborates, pending review, and a dismissal lifts it', async () => {
      const reporter = await e2e.register('minor-reporter');
      const second = await e2e.register('minor-reporter-2');
      const reported = await e2e.register('minor-reported');
      await e2e.as(reported.token).get('/users/me').expect(200);

      await report(reporter.token, 'USER', reported.id, 'MENOR_DE_EDAD').expect(201);
      expect(await suspendedUntil(reported.id)).toBeNull();
      await report(second.token, 'USER', reported.id, 'MENOR_DE_EDAD').expect(201);

      const refused = await e2e.as(reported.token).get('/users/me').expect(401);
      expect(JSON.stringify(refused.body)).toContain('Tu cuenta está suspendida mientras revisamos un reporte.');
      expect((await suspendedUntil(reported.id))?.getUTCFullYear()).toBe(9999);
      const [notice] = await selectRows<{ body: string }>(
        e2e, `SELECT body FROM notifications.messages WHERE recipient_user_id = :id AND metadata->>'type' = 'MODERATION_SUSPENSION_PENDING_REVIEW'`, { id: reported.id });
      expect(notice.body).toContain('Menor de edad');

      await resolveCase(e2e, moderator, { kind: 'USER', id: reported.id }, { confirmMinor: false });
      expect(await suspendedUntil(reported.id)).toBeNull();
      await e2e.as(reported.token).get('/users/me').expect(200);

      // N13: the person is told the review ended, in the app and by email, without the reporters.
      const cleared = (await inbox(e2e, reported.token)).find((item) => item.tipo === 'MODERATION_MINOR_REVIEW_CLEARED');
      expect(cleared?.mensaje).toContain('tu cuenta está activa otra vez');
      const emails = await selectRows<{ payload: { subject: string; body: string } }>(e2e,
        `SELECT payload FROM integration.outbox_jobs
          WHERE queue_name = 'notifications.delivery' AND aggregate_id = :id AND payload->>'kind' = 'NOTICE_EMAIL'
            AND payload->>'subject' LIKE '%Tu cuenta está activa otra vez'`, { id: reported.id });
      expect(emails).toHaveLength(1);
      for (const text of [cleared?.mensaje ?? '', emails[0].payload.body]) {
        for (const reporterId of [reporter.id, second.id]) expect(text).not.toContain(reporterId);
        expect(text).not.toContain('E2E minor-reporter');
      }
    });

    it('a confirmed minor stays suspended and the account closure is requested, without a strike', async () => {
      const reporter = await e2e.register('minor-confirm-reporter');
      const reported = await e2e.register('minor-confirm-reported');
      await report(reporter.token, 'USER', reported.id, 'MENOR_DE_EDAD').expect(201);

      const resolved = await resolveCase(e2e, moderator, { kind: 'USER', id: reported.id }, { confirmMinor: true, sanction: true });
      expect(resolved.body.data).toMatchObject({ minorConfirmed: true, sanction: null });
      const [row] = await selectRows<{ resolution: string }>(
        e2e, `SELECT resolution FROM moderation.reports WHERE reported_user_id = :id`, { id: reported.id });
      expect(row.resolution).toBe('MENOR_CONFIRMADO');
      expect((await suspendedUntil(reported.id))?.getUTCFullYear()).toBe(9999);
      expect(await selectRows(e2e, 'SELECT 1 FROM moderation.user_strikes WHERE user_id = :id', { id: reported.id })).toEqual([]);
      const jobs = await selectRows<{ payload: { userId: string } }>(
        e2e, `SELECT payload FROM integration.outbox_jobs WHERE queue_name = :queue AND aggregate_id = :id`,
        { queue: MINOR_ACCOUNT_CLOSURE_QUEUE, id: reported.id });
      expect(jobs).toEqual([{ payload: { schemaVersion: 1, userId: reported.id } }]);
    });

    it('never suspends a staff account (a member cannot lock out the gym)', async () => {
      const reporter = await e2e.register('minor-staff-reporter');
      const coach = await e2e.register('minor-staff-coach');
      const second = await e2e.register('minor-staff-reporter-2');
      await e2e.promote(coach.id, 'COACH');
      await report(reporter.token, 'USER', coach.id, 'MENOR_DE_EDAD').expect(201);
      await report(second.token, 'USER', coach.id, 'MENOR_DE_EDAD').expect(201);
      expect(await suspendedUntil(coach.id)).toBeNull();
    });
  });

  it('a sanction notice names the reason category and its short text', async () => {
    const reporter = await e2e.register('notice-reporter');
    const reported = await e2e.register('notice-reported');
    await report(reporter.token, 'USER', reported.id, 'ACOSO').expect(201);
    await resolveCase(e2e, moderator, { kind: 'USER', id: reported.id }, { sanction: true, note: 'interna' });

    const notice = (await inbox(e2e, reported.token)).find((item) => item.tipo === 'MODERATION_SANCTION');
    expect(notice?.mensaje).toContain('Motivo: Acoso (mensajes o contenido que hostigan o intimidan a otra persona).');
    expect(notice?.mensaje).not.toContain('interna');
  });

  it('the reported person cannot tell who reported them: no pass, no actor in the revocation', async () => {
    const reporter = await e2e.register('anon-reporter');
    const reported = await e2e.register('anon-reported');
    const passer = await e2e.register('anon-passer');
    const conversationId = await openConversation(e2e, reporter, reported);
    // Control: an ordinary pass is listed and counted.
    await e2e.sql('INSERT INTO social.discovery_passes (viewer_id, target_id) VALUES (:viewer, :target)', { viewer: passer.id, target: reported.id });
    const socket = await connectChatSocket(e2e, baseUrl, reported.token);
    try {
      await emitWithAck(socket, 'conversation:join', { conversationId });
      const revoked = new Promise<Record<string, unknown>>((resolve) => socket.once('conversation:revoked', resolve));

      await report(reporter.token, 'USER', reported.id, 'ACOSO').expect(201);

      expect(await revoked).toEqual({ conversationId });
    } finally {
      socket.disconnect();
    }
    const received = await e2e.as(reported.token).get('/me/interactions/passes-received').expect(200);
    expect(JSON.stringify(received.body)).not.toContain(reporter.id);
    const counts = await e2e.as(reported.token).get('/me/interactions/counts').expect(200);
    expect(counts.body.data.passesReceived).toBe(1);
    // The reporter still stops seeing the reported person.
    const [pass] = await selectRows<{ origin: string }>(e2e,
      'SELECT origin FROM social.discovery_passes WHERE viewer_id = :viewer AND target_id = :target', { viewer: reporter.id, target: reported.id });
    expect(pass.origin).toBe('REPORT');
  });

  describe('reported chat messages', () => {
    const send = async (token: string, conversationId: string, body: string) =>
      (await e2e.as(token).post(`/me/conversations/${conversationId}/messages`).send({ body }).expect(201)).body.data.id as string;
    const evidence = (messageId: string) =>
      selectRows<{ body: string | null }>(e2e, 'SELECT body FROM moderation.chat_message_evidence WHERE message_id = :messageId', { messageId });

    it('keep an evidence copy that survives delete-for-everyone and goes after resolution + retention', async () => {
      const reporter = await e2e.register('evidence-reporter');
      const sender = await e2e.register('evidence-sender');
      const conversationId = await openConversation(e2e, reporter, sender);
      const messageId = await send(sender.token, conversationId, `Mensaje ofensivo ${randomUUID()}`);
      const [original] = await selectRows<{ body: string }>(e2e, 'SELECT body FROM chat.messages WHERE id = :messageId', { messageId });

      await report(reporter.token, 'CHAT_MESSAGE', messageId, 'ACOSO').expect(201);
      // A 1:1 report also revokes the chat; a conversation a report does not
      // revoke (group or system thread) stays writable, so reopen it here.
      await e2e.sql('UPDATE chat.conversations SET revoked_at = NULL, revoked_by_user_id = NULL WHERE id = :conversationId', { conversationId });
      await e2e.as(sender.token).del(`/me/conversations/${conversationId}/messages/${messageId}?scope=EVERYONE`).expect(200);

      const [emptied] = await selectRows<{ body: string | null }>(e2e, 'SELECT body FROM chat.messages WHERE id = :messageId', { messageId });
      expect(emptied.body).toBeNull();
      expect(await evidence(messageId)).toEqual([{ body: original.body }]);
      const kase = await e2e.as(moderator.token).get(`/admin/moderation/cases/CHAT_MESSAGE/${messageId}`).expect(200);
      expect(kase.body.data.evidence).toMatchObject({ messageId, body: original.body, senderId: sender.id });

      await resolveCase(e2e, moderator, { kind: 'CHAT_MESSAGE', id: messageId }, { sanction: false });
      const [closed] = await selectRows<{ resolvedAt: Date }>(e2e,
        `SELECT resolved_at AS "resolvedAt" FROM moderation.reports WHERE target_id = :messageId`, { messageId });
      const purge = e2e.app.get(ModerationEvidenceService);
      await purge.purgeExpired(new Date(closed.resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS - 1) * DAY_MS));
      expect(await evidence(messageId)).toHaveLength(1);
      await purge.purgeExpired(new Date(closed.resolvedAt.getTime() + (REPORT_EVIDENCE_RETENTION_DAYS + 1) * DAY_MS));
      expect(await evidence(messageId)).toEqual([]);
    });

    it('a reported disappearing message is kept only while the report is open', async () => {
      const reporter = await e2e.register('vanish-reporter');
      const sender = await e2e.register('vanish-sender');
      const conversationId = await openConversation(e2e, reporter, sender);
      await e2e.as(sender.token).put(`/me/conversations/${conversationId}/disappearing`).send({ seconds: 86_400 }).expect(200);
      const messageId = await send(sender.token, conversationId, 'Temporal denunciado');
      await report(reporter.token, 'CHAT_MESSAGE', messageId, 'ACOSO').expect(201);
      await e2e.sql(`UPDATE chat.messages SET expires_at = now() - interval '1 minute' WHERE id = :messageId`, { messageId });
      const messageRows = () => selectRows(e2e, 'SELECT 1 FROM chat.messages WHERE id = :messageId', { messageId });
      const purge = e2e.app.get(ChatDisappearingPurgeService);

      await purge.purgeOnce();
      expect(await messageRows()).toHaveLength(1);

      await resolveCase(e2e, moderator, { kind: 'CHAT_MESSAGE', id: messageId }, { sanction: false });
      await purge.purgeOnce();
      expect(await messageRows()).toEqual([]);
      expect(await evidence(messageId)).toEqual([{ body: 'Temporal denunciado' }]);
    });
  });

  it('a file still referenced by an evidence copy survives a media release and the closure keeps it', async () => {
    const sender = await e2e.register('evidence-media');
    const key = `users/${sender.id}/chats/${randomUUID()}/${randomUUID()}.bin`;
    const path = writeStoredFile(key);
    const messageId = randomUUID();
    await e2e.sql(`INSERT INTO moderation.chat_message_evidence (message_id, conversation_id, sender_id, type, media_provider, media_key, sent_at)
      VALUES (:messageId, :conversationId, :senderId, 'image', 'local', :key, now())`,
    { messageId, conversationId: randomUUID(), senderId: sender.id, key });
    const sequelize = e2e.app.get(Sequelize);
    const release = (aggregateId: string) => sequelize.transaction((transaction) =>
      e2e.app.get(MediaReleaseService).requestRelease({ aggregateType: 'chat.message', aggregateId, storageKey: key }, transaction));
    const closure = e2e.app.get(AccountClosureRepository);
    await expect(closure.runInTransaction((transaction) => closure.keysStillInUse([key], transaction))).resolves.toEqual(new Set([key]));

    await release(randomUUID());
    await e2e.app.get(MediaReleaseService).drainOnce();
    expect(existsSync(path)).toBe(true);

    await e2e.sql('DELETE FROM moderation.chat_message_evidence WHERE message_id = :messageId', { messageId });
    await release(randomUUID());
    await e2e.app.get(MediaReleaseService).drainOnce();
    expect(existsSync(path)).toBe(false);
  });

  it('auto-hide after 3 distinct reporters opens a review item, tells the author, and a moderator restores it', async () => {
    const author = await e2e.register('autohide-author');
    const reporters = [await e2e.register('autohide-r1'), await e2e.register('autohide-r2'), await e2e.register('autohide-r3')];
    const exerciseId = await createPersonalExercise(e2e.as(author.token), `Autohide ${Date.now()}`);
    const created = await e2e.as(author.token).post('/routines')
      .send({ nombre: `Autohide ${Date.now()}`, dias: [{ diaSemana: 2, ejercicios: [{ ejercicioId: exerciseId }] }] }).expect(201);
    const routineId = created.body.data.id as string;
    await e2e.as(author.token).post(`/routines/${routineId}/publish`).expect(201);

    for (const [index, reporter] of reporters.entries()) {
      const response = await report(reporter.token, 'ROUTINE', routineId, 'SPAM').expect(201);
      expect(response.body.data.contentHidden).toBe(index === 2);
    }

    const reviews = await selectRows<{ outcome: string | null; distinct_reporters: number }>(e2e,
      'SELECT outcome, distinct_reporters FROM moderation.auto_hide_reviews WHERE target_id = :routineId', { routineId });
    expect(reviews).toEqual([{ outcome: null, distinct_reporters: 3 }]);
    const queue = await e2e.as(moderator.token).get('/admin/moderation/queue?pageSize=50').expect(200);
    expect((queue.body.data as { target_id: string; auto_hidden: boolean }[]).find((row) => row.target_id === routineId))
      .toMatchObject({ auto_hidden: true });
    const hidden = (await inbox(e2e, author.token)).find((item) => item.tipo === 'CONTENT_HIDDEN');
    expect(hidden?.mensaje).toContain('mientras una persona del equipo de moderación lo revisa');
    expect(hidden?.mensaje).toContain('Motivo: Spam');

    await resolveCase(e2e, moderator, { kind: 'ROUTINE', id: routineId }, { hideContent: false });

    const [routine] = await selectRows<{ estado: string }>(e2e,
      'SELECT estado_moderacion AS estado FROM training.routines WHERE id = :routineId', { routineId });
    expect(routine.estado).toBe('VISIBLE');
    const [closed] = await selectRows<{ outcome: string }>(e2e,
      'SELECT outcome FROM moderation.auto_hide_reviews WHERE target_id = :routineId', { routineId });
    expect(closed.outcome).toBe('RESTORED');
    expect((await inbox(e2e, author.token)).map((item) => item.tipo)).toContain('CONTENT_RESTORED');
  });
});
