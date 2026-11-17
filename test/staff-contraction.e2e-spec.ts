import { randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { staffRolesToMembersMigration } from '../src/database/migrations/202611201301-staff-roles-to-members';
import { retireStaffAndAccessControlMigration } from '../src/database/migrations/202611201302-retire-staff-and-access-control';
import { retireTenantAdminChatsMigration } from '../src/database/migrations/202611201303-retire-tenant-admin-chats';
import { DatabaseMigration } from '../src/database/migrations/migration.types';
import { bootE2eApp, E2eApp } from './support/e2e-app';

const PASSWORD = 'e2e-strong-password';
const STAFF_ROLES = ['ADMIN', 'FRONT_DESK', 'COACH', 'ENTRENADOR_EXTERNO'] as const;

/**
 * Franja 7d (ADR-0029): the staff roles, the staff and access-control tables
 * and the gym admin chat leave the product. Each migration is run up, down and
 * up again inside a transaction that is rolled back, so the shared schema is
 * left as it was; the person-facing checks run on committed data.
 */
describe('Staff contraction (e2e, franja 7d)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
  }, 60000);
  afterAll(async () => e2e?.app.close());

  const rows = <T extends object>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction) =>
    sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements, transaction });
  const exists = async (name: string, transaction?: Transaction) =>
    (await rows<{ found: boolean }>('SELECT to_regclass(:name) IS NOT NULL AS found', { name }, transaction))[0].found;
  const rolesOf = async (ids: string[], transaction: Transaction) =>
    (await rows<{ rol: string }>('SELECT rol FROM public.usuarios WHERE id IN (:ids) ORDER BY array_position(ARRAY[:ids]::uuid[], id)',
      { ids }, transaction)).map((row) => row.rol);
  const run = (migration: DatabaseMigration, step: 'up' | 'down', transaction: Transaction) =>
    migration[step](sequelize.getQueryInterface(), transaction);
  /** Rolled back at the end: the shared schema and its data are left as they were. */
  async function rolledBack(work: (transaction: Transaction) => Promise<void>): Promise<void> {
    const transaction = await sequelize.transaction();
    try {
      await work(transaction);
    } finally {
      await transaction.rollback();
    }
  }
  const withRole = async (userId: string, role: string) => {
    const transaction = await sequelize.transaction();
    await run(staffRolesToMembersMigration, 'down', transaction);
    await sequelize.query('UPDATE public.usuarios SET rol = :role WHERE id = :userId', { replacements: { role, userId }, transaction });
    await run(staffRolesToMembersMigration, 'up', transaction);
    await transaction.commit();
  };

  it('converts every staff role into a member, restores exactly those roles on down, and narrows the CHECK', async () => {
    const staff = [];
    for (const role of STAFF_ROLES) staff.push(await e2e.register(`f7d-${role.toLowerCase()}`));
    const moderator = await e2e.register('f7d-keeps-moderator');
    const ids = [...staff.map((account) => account.id), moderator.id];
    await rolledBack(async (transaction) => {
      await run(staffRolesToMembersMigration, 'down', transaction);
      for (const [index, role] of STAFF_ROLES.entries()) {
        await sequelize.query('UPDATE public.usuarios SET rol = :role WHERE id = :id', { replacements: { role, id: ids[index] }, transaction });
      }
      await sequelize.query(`UPDATE public.usuarios SET rol = 'MODERATOR' WHERE id = :id`, { replacements: { id: moderator.id }, transaction });

      await run(staffRolesToMembersMigration, 'up', transaction);
      expect(await rolesOf(ids, transaction)).toEqual(['CLIENTE', 'CLIENTE', 'CLIENTE', 'CLIENTE', 'MODERATOR']);
      const ledger = await rows<{ previous_role: string }>(
        'SELECT previous_role FROM retired.staff_role_conversions WHERE user_id IN (:ids) ORDER BY previous_role', { ids }, transaction);
      expect(ledger.map((row) => row.previous_role)).toEqual([...STAFF_ROLES].sort());
      await sequelize.query('SAVEPOINT refused', { transaction });
      await expect(sequelize.query(`UPDATE public.usuarios SET rol = 'COACH' WHERE id = :id`, { replacements: { id: ids[0] }, transaction }))
        .rejects.toThrow(/ck_usuarios_rol/u);
      await sequelize.query('ROLLBACK TO SAVEPOINT refused', { transaction });

      await run(staffRolesToMembersMigration, 'down', transaction);
      expect(await rolesOf(ids, transaction)).toEqual([...STAFF_ROLES, 'MODERATOR']);
      expect(await exists('retired.staff_role_conversions', transaction)).toBe(false);
      await run(staffRolesToMembersMigration, 'up', transaction);
      await run(staffRolesToMembersMigration, 'up', transaction);
      expect(await rolesOf(ids, transaction)).toEqual(['CLIENTE', 'CLIENTE', 'CLIENTE', 'CLIENTE', 'MODERATOR']);
    });
  }, 60000);

  it('a converted staff account signs in as a person, uses member routes and can close its own account', async () => {
    const coach = await e2e.register('f7d-converted');
    await withRole(coach.id, 'COACH');
    const [{ email }] = await rows<{ email: string }>('SELECT email FROM public.usuarios WHERE id = :id', { id: coach.id });
    // Retired records of the former staff member, which the closure must still erase.
    const conversationId = randomUUID();
    await e2e.sql(`INSERT INTO retired.membership_staff_profiles (id, user_id, position, hired_on, metadata)
                   VALUES (:id, :userId, 'COACH', '2025-01-01', '{"note":"x"}')`, { id: randomUUID(), userId: coach.id });
    await e2e.sql(`INSERT INTO retired.chat_tenant_admin_conversations (id, kind, system_kind) VALUES (:conversationId, 'SYSTEM', 'TENANT_ADMIN')`,
      { conversationId });
    await e2e.sql(`INSERT INTO retired.chat_tenant_admin_participants (conversation_id, user_id, can_write) VALUES (:conversationId, :userId, true)`,
      { conversationId, userId: coach.id });
    await e2e.sql(`INSERT INTO retired.chat_tenant_admin_messages (id, conversation_id, sender_id, type, body)
                   VALUES (:id, :conversationId, :userId, 'text', 'Hola socio')`, { id: randomUUID(), conversationId, userId: coach.id });

    const login = await request(e2e.http).post(e2e.url('/auth/login')).send({ email, password: PASSWORD }).expect(201);
    const token = login.body.data.accessToken as string;
    expect((await e2e.as(token).get('/auth/me').expect(200)).body.data).toMatchObject({ id: coach.id, rol: 'CLIENTE', accountKind: 'PERSON' });
    await e2e.as(token).get('/me/progression').expect(200);
    await e2e.as(token).get('/admin/users?q=x').expect(403);
    const preview = await e2e.as(token).get('/me/account/closure-preview').expect(200);
    expect(JSON.stringify(preview.body.data)).toContain('retired.membership_staff_profiles');

    await e2e.as(token).del('/me/account').send({ password: PASSWORD }).expect(200);
    const [profile] = await rows<{ employment_status: string; metadata: object }>(
      'SELECT employment_status, metadata FROM retired.membership_staff_profiles WHERE user_id = :id', { id: coach.id });
    expect(profile).toEqual({ employment_status: 'TERMINATED', metadata: {} });
    for (const table of ['retired.chat_tenant_admin_conversations', 'retired.chat_tenant_admin_messages']) {
      const where = table.endsWith('conversations') ? 'id' : 'conversation_id';
      expect(await rows(`SELECT 1 FROM ${table} WHERE ${where} = :conversationId`, { conversationId })).toEqual([]);
    }
    expect(await rows('SELECT 1 FROM retired.staff_role_conversions WHERE user_id = :id', { id: coach.id })).toEqual([]);
  }, 60000);

  it('moves the staff, access-control and permission tables to retired with their rows, and back on down', async () => {
    const account = await e2e.register('f7d-tables');
    await rolledBack(async (transaction) => {
      await run(retireStaffAndAccessControlMigration, 'down', transaction);
      expect(await exists('access_control.decisions', transaction)).toBe(true);
      const profileId = randomUUID();
      await sequelize.query(`INSERT INTO membership.staff_profiles (id, user_id, position, hired_on) VALUES (:profileId, :userId, 'FRONT_DESK', '2025-02-01')`,
        { replacements: { profileId, userId: account.id }, transaction });
      await sequelize.query(`INSERT INTO access_control.credentials (id, user_id, credential_type, provider, pin_hash)
                             VALUES (gen_random_uuid(), :userId, 'PIN', 'INTERNAL', 'x')`, { replacements: { userId: account.id }, transaction });

      await run(retireStaffAndAccessControlMigration, 'up', transaction);
      expect(await exists('access_control.decisions', transaction)).toBe(false);
      expect(await exists('membership.staff_profiles', transaction)).toBe(false);
      expect(await exists('admin.user_permissions', transaction)).toBe(false);
      expect((await rows<{ schema: string | null }>(`SELECT to_regnamespace('access_control')::text AS schema`, {}, transaction))[0].schema).toBeNull();
      expect(await rows('SELECT 1 FROM retired.membership_staff_profiles WHERE id = :profileId', { profileId }, transaction)).toHaveLength(1);
      expect(await rows('SELECT 1 FROM retired.access_control_credentials WHERE user_id = :id', { id: account.id }, transaction)).toHaveLength(1);

      await run(retireStaffAndAccessControlMigration, 'down', transaction);
      expect(await rows('SELECT 1 FROM membership.staff_profiles WHERE id = :profileId', { profileId }, transaction)).toHaveLength(1);
      expect(await rows('SELECT 1 FROM access_control.credentials WHERE user_id = :id', { id: account.id }, transaction)).toHaveLength(1);
      await run(retireStaffAndAccessControlMigration, 'up', transaction);
      expect(await exists('retired.access_control_decisions', transaction)).toBe(true);
    });
  }, 60000);

  it('moves TENANT_ADMIN chats with their messages and ledger to retired, narrows the CHECK, and restores them on down', async () => {
    const member = await e2e.register('f7d-chat-member');
    const formerAdmin = await e2e.register('f7d-chat-admin');
    const conversationId = randomUUID();
    const messageId = randomUUID();
    await rolledBack(async (transaction) => {
      const sql = (statement: string) =>
        sequelize.query(statement, { replacements: { conversationId, messageId, memberId: member.id, adminId: formerAdmin.id }, transaction });
      await run(retireTenantAdminChatsMigration, 'down', transaction);
      await sql(`INSERT INTO chat.conversations (id, kind, system_kind, revoked_at) VALUES (:conversationId, 'SYSTEM', 'TENANT_ADMIN', now())`);
      await sql(`INSERT INTO chat.participants (conversation_id, user_id, can_write) VALUES (:conversationId, :memberId, false), (:conversationId, :adminId, true)`);
      await sql(`INSERT INTO chat.messages (id, conversation_id, sender_id, type, body) VALUES (:messageId, :conversationId, :adminId, 'text', 'Bienvenido')`);
      await sql(`INSERT INTO chat.message_reactions (message_id, user_id, emoji) VALUES (:messageId, :memberId, '👍')`);
      await sql(`INSERT INTO chat.tenant_admin_chat_revocations (conversation_id, revoked_at) VALUES (:conversationId, now())`);
      const live = async () => (await rows('SELECT 1 FROM chat.messages WHERE id = :messageId', { messageId }, transaction)).length;

      await run(retireTenantAdminChatsMigration, 'up', transaction);
      expect(await live()).toBe(0);
      expect(await rows(`SELECT 1 FROM chat.conversations WHERE system_kind = 'TENANT_ADMIN'`, {}, transaction)).toEqual([]);
      expect(await rows('SELECT 1 FROM retired.chat_tenant_admin_participants WHERE conversation_id = :conversationId', { conversationId }, transaction))
        .toHaveLength(2);
      expect(await rows('SELECT 1 FROM retired.chat_tenant_admin_message_reactions WHERE message_id = :messageId', { messageId }, transaction))
        .toHaveLength(1);
      expect(await exists('retired.chat_tenant_admin_chat_revocations', transaction)).toBe(true);
      expect(await exists('chat.tenant_admin_chat_revocations', transaction)).toBe(false);
      await sequelize.query('SAVEPOINT refused', { transaction });
      await expect(sql(`INSERT INTO chat.conversations (id, kind, system_kind) VALUES (gen_random_uuid(), 'SYSTEM', 'TENANT_ADMIN')`))
        .rejects.toThrow(/ck_chat_conversations_system_kind/u);
      await sequelize.query('ROLLBACK TO SAVEPOINT refused', { transaction });

      await run(retireTenantAdminChatsMigration, 'down', transaction);
      expect(await live()).toBe(1);
      expect(await rows('SELECT 1 FROM chat.message_reactions WHERE message_id = :messageId', { messageId }, transaction)).toHaveLength(1);
      expect(await rows('SELECT 1 FROM chat.tenant_admin_chat_revocations WHERE conversation_id = :conversationId', { conversationId }, transaction))
        .toHaveLength(1);
      expect(await exists('retired.chat_tenant_admin_messages', transaction)).toBe(false);
      await run(retireTenantAdminChatsMigration, 'up', transaction);
      expect(await live()).toBe(0);
    });
  }, 60000);
});
