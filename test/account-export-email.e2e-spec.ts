import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AccountClosureService } from '../src/modules/account/account-closure.service';
import { ACCOUNT_EXPORT_SECTIONS } from '../src/modules/export/account-export.sections';
import { AccountExportService } from '../src/modules/export/account-export.service';
import { OutboxService } from '../src/modules/integration/outbox.service';
import { AccountDataRunner } from '../src/workers/account-data.runner';
import { seedPersonalData, selectOne } from './support/account-fixtures';
import { bootE2eApp, E2eApp } from './support/e2e-app';

const PASSWORD = 'e2e-strong-password';

describe('Account export and email change (e2e)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
  });
  afterAll(async () => e2e.app.close());

  const emailOf = async (userId: string) =>
    (await selectOne<{ email: string }>(sequelize, 'SELECT email FROM public.usuarios WHERE id = :userId', { userId }))!.email;
  const latestPin = async (userId: string, prefix: string) => {
    const row = await selectOne<{ body: string; metadata: Record<string, unknown> }>(sequelize,
      `SELECT body, metadata FROM notifications.messages
        WHERE recipient_user_id = :userId AND deduplication_key LIKE :prefix ORDER BY created_at DESC LIMIT 1`,
      { userId, prefix: `${prefix}%` });
    return { pin: /(\d{6})/u.exec(row?.body ?? '')?.[1] ?? '', metadata: row?.metadata };
  };

  describe('full export', () => {
    let owner: { token: string; id: string };
    let stranger: { token: string; id: string };
    let exportId: string;

    beforeAll(async () => {
      owner = await e2e.register('export-owner');
      stranger = await e2e.register('export-stranger');
      await seedPersonalData(sequelize, owner.id, stranger.id);
    });

    it('accepts one request per 24 hours', async () => {
      const response = await e2e.as(owner.token).post('/me/export').expect(202);
      expect(response.body.data).toMatchObject({ status: 'PENDING', downloadPath: null });
      exportId = response.body.data.id as string;
      const again = await e2e.as(owner.token).post('/me/export').expect(429);
      expect(again.body.code).toBe('ACCOUNT_EXPORT_RATE_LIMITED');
      expect(again.body.details.retryAfterSeconds).toBeGreaterThan(80_000);
    });

    it('answers 404 to someone else and 409 before the archive is ready', async () => {
      await e2e.as(stranger.token).get(`/me/export/${exportId}`).expect(404);
      await e2e.as(stranger.token).get(`/me/export/${exportId}/download`).expect(404);
      await e2e.as(owner.token).get(`/me/export/${exportId}/download`).expect(409);
      await e2e.as(owner.token).get('/me/export/not-a-uuid').expect(400);
      await request(e2e.http).get(e2e.url(`/me/export/${exportId}`)).expect(401);
    });

    it('builds an archive with every table of the data map, own rows only', async () => {
      const runner = new AccountDataRunner(
        e2e.app.get(OutboxService),
        e2e.app.get(AccountExportService),
        e2e.app.get(AccountClosureService),
      );
      await runner.drainOnce();
      const status = await e2e.as(owner.token).get(`/me/export/${exportId}`).expect(200);
      expect(status.body.data).toMatchObject({ status: 'READY', downloadPath: `/me/export/${exportId}/download` });

      const download = await e2e.as(owner.token).get(`/me/export/${exportId}/download`).buffer(true)
        .parse((res, callback) => {
          let text = '';
          res.on('data', (chunk: Buffer) => { text += chunk.toString('utf8'); });
          res.on('end', () => callback(null, text));
        }).expect(200);
      expect(download.headers['content-disposition']).toContain('attachment');
      const archive = JSON.parse(download.body as string);
      expect(Object.keys(archive.tables).sort()).toEqual(ACCOUNT_EXPORT_SECTIONS.map((section) => section.table).sort());
      const rows = (table: string) => archive.tables[table].rows as Record<string, unknown>[];
      expect(rows('public.usuarios')).toHaveLength(1);
      expect(rows('public.usuarios')[0]).not.toHaveProperty('password_hash');
      expect(rows('profile.onboarding')[0].physical_considerations).toBe('Lesión de rodilla');
      expect(rows('social.map_locations')).toHaveLength(1);
      expect(rows('directory.payment_orders')).toHaveLength(1);
      expect(rows('auth.refresh_tokens')[0]).not.toHaveProperty('token_hash');
      // Chat: own messages and conversation ids; never the other person's words.
      expect(rows('chat.messages').map((message) => message.body)).toEqual(['Mi secreto']);
      expect(download.body as string).not.toContain('Respuesta ajena');
      expect(rows('chat.participants')).toHaveLength(1);
    });
  });

  it('an export taken while an email-change PIN is pending never carries the PIN', async () => {
    const member = await e2e.register('export-pin');
    const newEmail = `pin-${member.id.slice(0, 8)}@example.test`;
    await e2e.as(member.token).post('/me/email/change').send({ newEmail, password: PASSWORD }).expect(202);
    const { pin } = await latestPin(member.id, 'email-change-');
    expect(pin).toMatch(/^\d{6}$/u);
    const requested = await e2e.as(member.token).post('/me/export').expect(202);
    await new AccountDataRunner(e2e.app.get(OutboxService), e2e.app.get(AccountExportService), e2e.app.get(AccountClosureService)).drainOnce();
    const download = await e2e.as(member.token).get(`/me/export/${requested.body.data.id as string}/download`).buffer(true)
      .parse((res, callback) => {
        let text = '';
        res.on('data', (chunk: Buffer) => { text += chunk.toString('utf8'); });
        res.on('end', () => callback(null, text));
      }).expect(200);
    expect(download.body as string).not.toContain(pin);
    expect(download.body as string).not.toContain('Tu código para usar este correo');
  });

  it('refuses an email change while a moderation strike still counts (ban evasion by change + closure)', async () => {
    const member = await e2e.register('email-sanctioned');
    await e2e.sql(`INSERT INTO moderation.user_strikes (id, user_id, tenant_id, kind, reason, expires_at)
      SELECT uuid_generate_v4(), u.id, COALESCE(u.tenant_id, (SELECT id FROM public.tenants ORDER BY id LIMIT 1)),
             'ADVERTENCIA', 'SPAM', now() + interval '30 days' FROM public.usuarios u WHERE u.id = :id`, { id: member.id });
    const refused = await e2e.as(member.token).post('/me/email/change')
      .send({ newEmail: `evade-${member.id.slice(0, 8)}@example.test`, password: PASSWORD }).expect(409);
    expect(refused.body.code).toBe('EMAIL_CHANGE_BLOCKED_BY_SANCTION');
    expect((await latestPin(member.id, 'email-change-')).pin).toBe('');
  });

  describe('email and name rectification', () => {
    it('changes the email after a PIN sent to the new address and tells the old one', async () => {
      const member = await e2e.register('email-change');
      const oldEmail = await emailOf(member.id);
      const newEmail = `renamed-${member.id.slice(0, 8)}@example.test`;
      const wrong = await e2e.as(member.token).post('/me/email/change').send({ newEmail, password: 'wrong-password' }).expect(400);
      expect(wrong.body.code).toBe('CURRENT_PASSWORD_INVALID');
      const same = await e2e.as(member.token).post('/me/email/change').send({ newEmail: oldEmail, password: PASSWORD }).expect(400);
      expect(same.body.code).toBe('EMAIL_UNCHANGED');
      await e2e.as(member.token).post('/me/email/change').send({ newEmail: newEmail.toUpperCase(), password: PASSWORD }).expect(202);

      const { pin, metadata } = await latestPin(member.id, 'email-change-');
      expect(metadata).toEqual({ recipientEmail: newEmail });
      const badPin = pin === '000000' ? '111111' : '000000';
      const refused = await e2e.as(member.token).post('/me/email/change/confirm').send({ pin: badPin }).expect(400);
      expect(refused.body.code).toBe('EMAIL_PIN_INVALID');
      expect(await emailOf(member.id)).toBe(oldEmail);

      const confirmed = await e2e.as(member.token).post('/me/email/change/confirm').send({ pin }).expect(200);
      expect(confirmed.body.data).toEqual({ email: newEmail, emailVerified: true });
      expect(await emailOf(member.id)).toBe(newEmail);
      const notice = await latestPin(member.id, 'email-changed-');
      expect(notice.metadata).toEqual({ kind: 'EMAIL_CHANGED', recipientEmail: oldEmail });
      await request(e2e.http).post(e2e.url('/auth/login')).send({ email: newEmail, password: PASSWORD }).expect(201);
      await request(e2e.http).post(e2e.url('/auth/login')).send({ email: oldEmail, password: PASSWORD }).expect(401);
    });

    it('answers 409 at confirmation when the address belongs to another account', async () => {
      const member = await e2e.register('email-taken');
      const holder = await e2e.register('email-holder');
      const taken = await emailOf(holder.id);
      await e2e.as(member.token).post('/me/email/change').send({ newEmail: taken, password: PASSWORD }).expect(202);
      const { pin } = await latestPin(member.id, 'email-change-');
      await e2e.as(member.token).post('/me/email/change/confirm').send({ pin }).expect(409);
      expect(await emailOf(holder.id)).toBe(taken);
      await request(e2e.http).post(e2e.url('/me/email/change/confirm')).send({ pin }).expect(401);
    });

    it('renames the account with the signup rules', async () => {
      const member = await e2e.register('rename');
      await e2e.as(member.token).patch('/me/account').send({ nombreCompleto: 'ab' }).expect(400);
      await e2e.as(member.token).patch('/me/account').send({ nombreCompleto: 'Ana Pérez', rol: 'ADMIN' }).expect(400);
      const response = await e2e.as(member.token).patch('/me/account').send({ nombreCompleto: '  Ana Pérez  ' }).expect(200);
      expect(response.body.data.nombreCompleto).toBe('Ana Pérez');
      expect(response.body.data.rol).toBe('CLIENTE');
    });
  });
});
