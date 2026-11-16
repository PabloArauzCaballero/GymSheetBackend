import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxJobModel } from '../src/modules/integration/outbox-job.model';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { Member, registerModerator, resolveCase } from './support/moderation-e2e';
import { selectRows } from './support/privacy-e2e';

const PASSWORD = 'e2e-strong-password';

type NoticeEmailJob = { id: string; payload: { to: string; subject: string; body: string; survivesClosure: boolean } };

/**
 * B1: a suspended or banned person learns why. The refusal at login and on
 * every request carries the public reason of the sanction, a ban answers its
 * own code once the password is right, and both notices also go by email to
 * the address on file (self-contained outbox job, delivered by the
 * notifications worker).
 */
describe('Sanction notices reach the person (e2e)', () => {
  let e2e: E2eApp;
  let moderator: Member;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    moderator = await registerModerator(e2e, 'sanction-notice-mod');
  }, 60000);
  afterAll(async () => e2e?.app.close());

  const emailOf = async (id: string) =>
    (await selectRows<{ email: string }>(e2e, 'SELECT email FROM public.usuarios WHERE id = :id', { id }))[0].email;
  const priorWarnings = (userId: string, count: number) =>
    e2e.sql(`INSERT INTO moderation.user_strikes (id, user_id, tenant_id, kind, reason, expires_at)
             SELECT uuid_generate_v4(), :userId, 'default', 'ADVERTENCIA', 'SPAM', now() + interval '30 days'
               FROM generate_series(1, :count)`, { userId, count });
  const sanction = async (author: Member, reason: string, note: string) => {
    const reporter = await e2e.register(`sanction-reporter-${randomUUID().slice(0, 8)}`);
    await e2e.as(reporter.token).post('/me/reports').send({ targetKind: 'USER', targetId: author.id, reason }).expect(201);
    await resolveCase(e2e, moderator, { kind: 'USER', id: author.id }, { sanction: true, hideContent: false, confirmMinor: false, note });
  };
  const noticeEmails = (userId: string) =>
    selectRows<NoticeEmailJob>(e2e,
      `SELECT id, payload FROM integration.outbox_jobs
        WHERE queue_name = 'notifications.delivery' AND aggregate_id = :userId AND payload->>'kind' = 'NOTICE_EMAIL'`, { userId });
  const login = (email: string, password: string) =>
    request(e2e.http).post(e2e.url('/auth/login')).send({ email, password });

  it('a suspension says why at login and on every request, and is emailed once', async () => {
    const author = await e2e.register('sanction-suspended');
    const email = await emailOf(author.id);
    await priorWarnings(author.id, 1);
    await sanction(author, 'ACOSO', 'nota interna del moderador');

    const refused = await login(email, PASSWORD).expect(403);
    expect(refused.body).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      details: {
        pendingReview: false,
        reason: { code: 'ACOSO', label: 'Acoso', text: 'mensajes o contenido que hostigan o intimidan a otra persona' },
      },
    });
    expect(typeof refused.body.details.until).toBe('string');
    const session = await e2e.as(author.token).get('/users/me').expect(401);
    expect(session.body).toMatchObject({ code: 'ACCOUNT_SUSPENDED', details: { reason: { code: 'ACOSO' } } });
    const serialized = JSON.stringify([refused.body, session.body]);
    expect(serialized).not.toContain('nota interna');
    expect(serialized).not.toContain(moderator.id);

    const [job, ...others] = await noticeEmails(author.id);
    expect(others).toEqual([]);
    expect(job.payload).toMatchObject({ to: email, survivesClosure: false });
    expect(job.payload.subject).toContain('Tu cuenta ha sido suspendida');
    expect(job.payload.body).toContain('Motivo: Acoso');
    expect(job.payload.body).not.toContain('nota interna');
    // The notifications worker's delivery path sends it (log transport here) without a message row.
    const model = await OutboxJobModel.findByPk(job.id);
    await expect(e2e.app.get(NotificationDeliveryService, { strict: false }).deliver(model!)).resolves.toBeUndefined();
  });

  it('a banned account learns of the ban and its reason, only with the right password', async () => {
    const author = await e2e.register('sanction-banned');
    const email = await emailOf(author.id);
    await priorWarnings(author.id, 9);
    await sanction(author, 'DISCURSO_DE_ODIO', 'nota');
    const [account] = await selectRows<{ estado: string }>(e2e, 'SELECT estado FROM public.usuarios WHERE id = :id', { id: author.id });
    expect(account.estado).toBe('INACTIVO');

    const banned = await login(email, PASSWORD).expect(403);
    expect(banned.body).toMatchObject({
      code: 'ACCOUNT_BANNED',
      details: { reason: { code: 'DISCURSO_DE_ODIO', label: 'Discurso de odio' } },
    });
    const wrong = await login(email, 'not-the-password').expect(401);
    expect(wrong.body.detail).toBe('Credenciales inválidas.');
    expect(JSON.stringify(wrong.body)).not.toContain('ACCOUNT_BANNED');

    const [job] = await noticeEmails(author.id);
    expect(job.payload).toMatchObject({ to: email });
    expect(job.payload.subject).toContain('Tu cuenta ha sido cerrada');
    expect(job.payload.body).toContain('Motivo: Discurso de odio');
  });

  it('any other inactive account keeps the generic 401, even with the right password', async () => {
    const other = await e2e.register('sanction-inactive');
    const email = await emailOf(other.id);
    await e2e.sql(`UPDATE public.usuarios SET estado = 'INACTIVO' WHERE id = :id`, { id: other.id });
    const refused = await login(email, PASSWORD).expect(401);
    expect(refused.body.detail).toBe('Credenciales inválidas.');
  });
});
