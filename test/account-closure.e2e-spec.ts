import { existsSync } from 'node:fs';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { ACCOUNT_CLOSURE_STEPS } from '../src/modules/account/account-closure.catalog';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { countRows, seedPersonalData, selectOne, SeededAccount, writeStoredFile } from './support/account-fixtures';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';

const PASSWORD = 'e2e-strong-password';

/**
 * References to `usuarios` that only staff accounts produce (closure is for
 * members only) or that cascade from a parent the catalogue deletes.
 */
const NOT_A_MEMBER_ROW = new Set([
  'facilities.equipment_assignments', 'facilities.maintenance_events', 'integration.legacy_import_batches',
  'directory.plan_price_history',
  // Cascade from training.training_invites.
  'training.training_invite_commands', 'training.training_invite_revisions',
  // Only business accounts produce these (ADR-0020): they close with BUSINESS_CLOSURE_STEPS, whose own
  // coverage is checked in test/business-closure.e2e-spec.ts (ADR-0028).
  'business.accounts', 'directory.handle_changes',
]);

describe('Account closure (e2e)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
  });
  afterAll(async () => e2e.app.close());

  const emailOf = async (userId: string) =>
    (await selectOne<{ email: string }>(sequelize, 'SELECT email FROM public.usuarios WHERE id = :userId', { userId }))!.email;

  it('lists in the catalogue every table that references an account', async () => {
    const rows = await sequelize.query<{ table: string }>(
      `SELECT DISTINCT n.nspname || '.' || c.relname AS table
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f' AND con.confrelid = 'public.usuarios'::regclass`,
      { type: QueryTypes.SELECT },
    );
    const covered = new Set(ACCOUNT_CLOSURE_STEPS.map((step) => step.table));
    const missing = rows.map((row) => row.table).filter((table) => !covered.has(table) && !NOT_A_MEMBER_ROW.has(table));
    expect(missing).toEqual([]);
  });

  describe('closing with the password', () => {
    let closer: { token: string; id: string };
    let other: { token: string; id: string };
    let email: string;
    let seeded: SeededAccount;
    let photoPath: string;
    let chatPath: string;
    let selfiePath: string;

    beforeAll(async () => {
      closer = await e2e.register('closer');
      other = await e2e.register('closer-peer');
      email = await emailOf(closer.id);
      seeded = await seedPersonalData(sequelize, closer.id, other.id);
      photoPath = writeStoredFile(seeded.photoKey);
      chatPath = writeStoredFile(seeded.chatKey);
      selfiePath = writeStoredFile(seeded.selfieKey);
    });

    it('previews what is deleted, anonymized and kept', async () => {
      const response = await e2e.as(closer.token).get('/me/account/closure-preview').expect(200);
      const preview = response.body.data;
      expect(preview.allowed).toBe(true);
      expect(preview.proof).toEqual({ password: true, emailPin: false });
      const tables = (items: { table: string }[]) => items.map((item) => item.table);
      expect(tables(preview.deleted)).toEqual(expect.arrayContaining([
        'profile.onboarding', 'social.map_locations', 'profile.photos', 'social.connections', 'auth.refresh_tokens',
      ]));
      expect(tables(preview.anonymized)).toEqual(expect.arrayContaining(['chat.messages', 'directory.payment_orders']));
      expect(tables(preview.kept)).toEqual(expect.arrayContaining(['auth.terms_acceptances']));
    });

    it('refuses a wrong password and leaves the account intact', async () => {
      const response = await e2e.as(closer.token).del('/me/account').send({ password: 'not-the-password' }).expect(400);
      expect(response.body.code).toBe('CURRENT_PASSWORD_INVALID');
      expect(await countRows(sequelize, 'profile.onboarding', 't.user_id = :userId', closer.id)).toBe(1);
    });

    it('rejects a body without proof', async () => {
      await e2e.as(closer.token).del('/me/account').send({}).expect(400);
    });

    it('closes the account in one go and removes personal data from every table', async () => {
      const seededTables = [
        ['profile.onboarding', 't.user_id = :userId'], ['profile.body_measurements', 't.user_id = :userId'],
        ['public.perfiles_antropometricos', 't.usuario_id = :userId'], ['public.sesiones_entrenamiento', 't.usuario_id = :userId'],
        ['training.routines', 't.created_by_user_id = :userId'], ['progression.user_progress', 't.usuario_id = :userId'],
        ['social.profile_details', 't.user_id = :userId'], ['social.profile_settings', 't.user_id = :userId'],
        ['social.discovery_preferences', 't.user_id = :userId'], ['social.map_locations', 't.user_id = :userId'],
        ['social.connections', 't.requester_id = :userId'], ['social.discovery_passes', 't.target_id = :userId'],
        ['social.user_blocks', 't.blocker_id = :userId'], ['profile.profile_views', 't.viewed_user_id = :userId'],
        ['profile.photos', 't.user_id = :userId'], ['profile.stories', 't.user_id = :userId'],
        ['social.reels', 't.user_id = :userId'], ['community.content_comments', 't.autor_id = :userId'],
        ['notifications.messages', 't.recipient_user_id = :userId'], ['notifications.device_tokens', 't.user_id = :userId'],
        ['auth.user_devices', 't.user_id = :userId'], ['auth.refresh_tokens', 't.user_id = :userId'],
        ['auth.email_verification_pins', 't.user_id = :userId'], ['social.photo_verifications', 't.user_id = :userId'],
      ] as const;
      for (const [table, where] of seededTables) {
        expect([table, (await countRows(sequelize, table, where, closer.id)) > 0]).toEqual([table, true]);
      }

      const response = await e2e.as(closer.token).del('/me/account').send({ password: PASSWORD }).expect(200);
      expect(response.body.data.closed).toBe(true);

      for (const [table, where] of seededTables) {
        expect([table, await countRows(sequelize, table, where, closer.id)]).toEqual([table, 0]);
      }
      for (const step of ACCOUNT_CLOSURE_STEPS.filter((candidate) => candidate.disposition === 'DELETED')) {
        expect([step.table, await countRows(sequelize, step.table, step.where, closer.id)]).toEqual([step.table, 0]);
      }
    });

    it('anonymizes the account row and the chat, keeping the other person messages', async () => {
      const account = await selectOne<Record<string, unknown>>(sequelize,
        `SELECT email, nombre_completo, fecha_nacimiento, genero, estado, closed_at FROM public.usuarios WHERE id = :id`,
        { id: closer.id });
      expect(account).toMatchObject({
        email: `cerrada-${closer.id}@cuenta-cerrada.invalid`, nombre_completo: 'Cuenta cerrada',
        fecha_nacimiento: null, genero: null, estado: 'INACTIVO',
      });
      expect(account?.closed_at).not.toBeNull();
      const own = await selectOne<Record<string, unknown>>(sequelize,
        'SELECT body, media_key, deleted_at FROM chat.messages WHERE id = :id', { id: seeded.ownMessageId });
      expect(own).toMatchObject({ body: null, media_key: null });
      expect(own?.deleted_at).not.toBeNull();
      const theirs = await selectOne<{ body: string }>(sequelize, 'SELECT body FROM chat.messages WHERE id = :id', { id: seeded.otherMessageId });
      expect(theirs?.body).toBe('Respuesta ajena');
      const participation = await selectOne<{ nickname: string | null }>(sequelize,
        'SELECT nickname FROM chat.participants WHERE conversation_id = :c AND user_id = :u', { c: seeded.conversationId, u: closer.id });
      expect(participation?.nickname).toBeNull();
    });

    it('keeps the gym tax records de-identified', async () => {
      const order = await selectOne<Record<string, unknown>>(sequelize,
        'SELECT amount, athlete_notes, receipt_reference, athlete_user_id FROM directory.payment_orders WHERE id = :id',
        { id: seeded.paymentOrderId });
      expect(order).toMatchObject({ amount: '150.00', athlete_notes: null, receipt_reference: 'BANCO-123', athlete_user_id: closer.id });
      const customer = await selectOne<Record<string, unknown>>(sequelize,
        'SELECT phone_number, notes, customer_number FROM retired.membership_customer_profiles WHERE user_id = :id', { id: closer.id });
      expect(customer).toMatchObject({ phone_number: null, notes: null });
      expect(customer?.customer_number).toMatch(/^C-/);
      expect(await countRows(sequelize, 'membership.memberships', 't.user_id = :userId AND t.notes IS NULL', closer.id)).toBe(1);
      expect(await countRows(sequelize, 'retired.access_control_credentials', "t.user_id = :userId AND t.status = 'REVOKED'", closer.id)).toBe(1);
    });

    it('erases the stored files through the shared media.release outbox queue', async () => {
      expect(existsSync(photoPath)).toBe(true);
      expect(existsSync(selfiePath)).toBe(true);
      await e2e.app.get(MediaReleaseService).drainOnce();
      expect(existsSync(photoPath)).toBe(false);
      expect(existsSync(chatPath)).toBe(false);
      expect(existsSync(selfiePath)).toBe(false);
    });

    it('rejects the old session and the old credentials with the generic message', async () => {
      await e2e.as(closer.token).get('/users/me').expect(401);
      const login = await request(e2e.http).post(e2e.url('/auth/login')).send({ email, password: PASSWORD }).expect(401);
      expect(login.body.detail).toBe('Credenciales inválidas.');
    });

    it('lets the same email sign up again as a new account', async () => {
      const ticket = await request(e2e.http).get(e2e.url('/auth/register/ticket')).expect(200);
      const response = await request(e2e.http).post(e2e.url('/auth/register')).send({
        ticket: ticket.body.data.ticket as string, email, password: PASSWORD, nombreCompleto: 'Vuelvo', ...E2E_SIGNUP_FIELDS,
      }).expect(201);
      expect(response.body.data.user?.id ?? response.body.data.usuario?.id).not.toBe(closer.id);
    });
  });

  it('closes a Google/Apple account with an email PIN and refuses a wrong one', async () => {
    const member = await e2e.register('closer-pin');
    await e2e.as(member.token).del('/me/account').send({ pin: '123456' }).expect(400);
    await e2e.sql(`INSERT INTO auth.identities (provider, subject, user_id) VALUES ('GOOGLE', :subject, :userId)`,
      { subject: `sub-${member.id}`, userId: member.id });
    await e2e.as(member.token).post('/me/account/closure-pin').expect(202);
    const message = await selectOne<{ body: string }>(sequelize,
      `SELECT body FROM notifications.messages WHERE recipient_user_id = :id AND deduplication_key LIKE 'account-closure-%'`,
      { id: member.id });
    const pin = /(\d{6})/u.exec(message?.body ?? '')?.[1] ?? '';
    const wrong = pin === '000000' ? '111111' : '000000';
    const refused = await e2e.as(member.token).del('/me/account').send({ pin: wrong }).expect(400);
    expect(refused.body.code).toBe('EMAIL_PIN_INVALID');
    await e2e.as(member.token).del('/me/account').send({ pin }).expect(200);
    expect(await countRows(sequelize, 'auth.identities', 't.user_id = :userId', member.id)).toBe(0);
  });

  it('refuses closure of platform accounts and of a session without a token', async () => {
    const coach = await e2e.register('closer-moderator');
    await e2e.promote(coach.id, 'MODERATOR');
    await e2e.as(coach.token).del('/me/account').send({ password: PASSWORD }).expect(403);
    await request(e2e.http).delete(e2e.url('/me/account')).send({ password: PASSWORD }).expect(401);
  });
});
