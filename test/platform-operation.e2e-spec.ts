import { randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { revokeTenantAdminChatsMigration } from '../src/database/migrations/202611200301-revoke-tenant-admin-chats';
import { businessNameSkeleton } from '../src/modules/business-accounts/handle-rules';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';
import { LEGACY_STAFF_ROLES, legacyGymStaff } from './support/legacy-staff';

/**
 * Franja 7a (ADR-0019): REPP operates the platform and the gym has no staff.
 * Legacy gym `ADMIN`/`FRONT_DESK`/`COACH` accounts keep their role value until
 * franja 7d, but it opens nothing: every `admin/*` route is REPP's, the coach
 * assignment routes are gone, and the pinned gym admin chat no longer exists.
 */
describe('REPP operates the platform; the gym has no staff (e2e, franja 7a)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;
  let platform: { token: string; id: string };
  const uuid = randomUUID();

  type Route = [method: 'get' | 'post' | 'put' | 'patch' | 'del', path: string, body?: object];
  // At least one route per `admin/*` controller (the full set is checked by
  // roles.guard.admin-routes.spec.ts); `admin/directory` no longer exists (ADR-0024), nor
  // `admin/membership` and `admin/access` (ADR-0026).
  const adminRoutes: Route[] = [
    ['post', '/admin/exercises/global', {}],
    ['get', '/admin/exercises/import/exercises-dataset/status'],
    ['get', `/admin/support/users/${uuid}/training`],
    ['get', '/admin/verifications'],
    ['get', '/admin/routines'],
    ['post', `/admin/routines/${uuid}/official`],
    ['get', `/admin/routines/${uuid}/insights`],
    ['get', '/admin/moderation/queue'],
    ['get', '/admin/platform/moderators'],
    ['get', '/admin/progression/levels'],
    ['post', '/admin/progression/prizes/redeem', { code: 'NOPE' }],
    ['get', '/admin/users?q=x&roles=CLIENTE'],
    ['post', `/admin/users/${uuid}/close`],
    ['get', '/admin/media'],
    ['post', '/admin/notifications/broadcast', {}],
    ['get', '/admin/facilities/branches'],
    ['post', '/admin/facilities/branches', {}],
    ['get', '/admin/tenants'],
    ['get', '/admin/signups'],
    ['get', '/admin/audit'],
    ['get', '/admin/permissions/catalog'],
    ['get', `/admin/permissions/${uuid}`],
    ['get', '/admin/equipment/catalog'],
  ];
  const call = (token: string, [method, path, body]: Route) => {
    const pending = e2e.as(token)[method](path);
    return body ? pending.send(body) : pending;
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    platform = await e2e.platformAdmin('f7a-platform');
  }, 60000);

  afterAll(async () => {
    await e2e?.app.close();
  });

  describe('admin/* is REPP only', () => {
    it.each(LEGACY_STAFF_ROLES)('a legacy gym %s gets 403 on every admin/* route, even holding every permission grant', async (role) => {
      const keys = (await sequelize.query<{ key: string }>('SELECT key FROM admin.permissions', { type: QueryTypes.SELECT }))
        .map((row) => row.key);
      const staff = await legacyGymStaff(e2e, `f7a-${role.toLowerCase()}`, role, { keys });
      const admitted: string[] = [];
      for (const route of adminRoutes) {
        const response = await call(staff.token, route);
        if (response.status !== 403) admitted.push(`${route[0]} ${route[1]} -> ${response.status}`);
      }
      expect(admitted).toEqual([]);
    }, 60000);

    it('the platform SYSTEM_ADMIN passes the role check on the same routes', async () => {
      const refused: string[] = [];
      for (const route of adminRoutes) {
        const response = await call(platform.token, route);
        if (response.status === 401 || response.status === 403) refused.push(`${route[0]} ${route[1]} -> ${response.status}`);
      }
      expect(refused).toEqual([]);
    }, 60000);
  });

  describe('directory listings: owner or REPP', () => {
    const gym = env.DEFAULT_TENANT_ID;
    let entityId = '';
    let reviewId = '';
    let owner: { token: string; id: string };

    beforeAll(async () => {
      owner = await e2e.register('f7a-dir-owner');
      const author = await e2e.register('f7a-dir-author');
      entityId = randomUUID();
      reviewId = randomUUID();
      await e2e.sql(
        `INSERT INTO directory.entities (id, slug, entity_type, name, name_skeleton, description, primary_category_id, tenant_id, user_id)
         VALUES (:entityId, :slug, 'GYM', 'Ficha 7a', :skeleton, 'Ficha de prueba', 'a1000000-0000-4000-8000-000000000002', :gym, :ownerId)`,
        { entityId, slug: `f7a-${entityId.slice(0, 8)}`, skeleton: businessNameSkeleton('Ficha 7a'), gym, ownerId: owner.id },
      );
      await e2e.sql(
        `INSERT INTO directory.reviews (id, entity_id, user_id, rating, title, body)
         VALUES (:reviewId, :entityId, :authorId, 4, 'Bien', 'Buen gimnasio para entrenar')`,
        { reviewId, entityId, authorId: author.id },
      );
    }, 60000);

    const paymentConfig = {
      bankName: 'Banco 7a', accountHolderName: 'Titular 7a', taxId: '1234567', accountNumber: '10000001',
      qrImageUrl: 'https://example.test/qr.png',
    };

    it("a legacy gym ADMIN of the listing's gym who does not own it gets 404 on its payments and 403 replying", async () => {
      const staff = await legacyGymStaff(e2e, 'f7a-dir-admin', 'ADMIN', { tenantId: gym });
      await e2e.as(staff.token).put(`/admin/directory/entities/${entityId}/payment-config`).send(paymentConfig).expect(404);
      await e2e.as(staff.token).get(`/admin/directory/entities/${entityId}/payment-orders`).expect(404);
      await e2e.as(staff.token).post(`/directory/reviews/${reviewId}/reply`).send({ reply_text: 'Gracias por venir' }).expect(403);
      const [config] = await sequelize.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM directory.entity_payment_configs WHERE entity_id = :entityId',
        { type: QueryTypes.SELECT, replacements: { entityId } },
      );
      expect(config.count).toBe('0');
    });

    it('REPP no longer manages money (D9): the admin/directory console is gone for the owner and SYSTEM_ADMIN; replies stay', async () => {
      // Franja 8d (ADR-0024): payment data and orders live under business/me/*, only for the owning business account.
      await e2e.as(owner.token).put(`/admin/directory/entities/${entityId}/payment-config`).send(paymentConfig).expect(404);
      await e2e.as(platform.token).get(`/admin/directory/entities/${entityId}/payment-orders`).expect(404);
      await e2e.as(platform.token).post(`/admin/directory/payment-orders/${randomUUID()}/confirm`).expect(404);
      await e2e.as(platform.token).post(`/directory/reviews/${reviewId}/reply`).send({ reply_text: 'Gracias, equipo REPP' }).expect(201);
    });
  });

  describe('coach routine assignment is gone', () => {
    it('assigning and listing as coach answer 404 for any role; assignments made before stay visible to the member', async () => {
      const coach = await legacyGymStaff(e2e, 'f7a-assigner', 'COACH');
      const gymAdmin = await legacyGymStaff(e2e, 'f7a-assigner-admin', 'ADMIN');
      const member = await e2e.register('f7a-assigned');
      const exerciseId = await createPersonalExercise(e2e.as(coach.token), `f7a ex ${uuid.slice(0, 6)}`);
      const routine = await e2e.as(coach.token).post('/routines')
        .send({ nombre: `f7a plan ${uuid.slice(0, 6)}`, dias: [{ diaSemana: 1, ejercicios: [{ ejercicioId: exerciseId }] }] })
        .expect(201);
      const routineId = routine.body.data.id as string;

      for (const actor of [coach, gymAdmin, platform]) {
        await e2e.as(actor.token).post(`/routines/${routineId}/assign`).send({ clienteUsuarioId: member.id }).expect(404);
        await e2e.as(actor.token).get('/routines/assignments/coach').expect(404);
      }

      const assignmentId = randomUUID();
      await e2e.sql(
        `INSERT INTO training.routine_assignments (id, routine_id, cliente_user_id, asignado_por_user_id)
         VALUES (:assignmentId, :routineId, :memberId, :coachId)`,
        { assignmentId, routineId, memberId: member.id, coachId: coach.id },
      );
      const mine = await e2e.as(member.token).get('/routines/assignments/me').expect(200);
      expect((mine.body.data as { id: string; rutinaId: string }[]).map((item) => [item.id, item.rutinaId]))
        .toEqual([[assignmentId, routineId]]);
    }, 60000);
  });

  describe('system chats: REPP support only', () => {
    const corporateEmail = `f7a-corporativo-${uuid.slice(0, 8)}@example.test`;
    let previousCorporateEmail: string | undefined;

    beforeAll(async () => {
      previousCorporateEmail = env.SEED_SYSTEM_CORPORATE_EMAIL;
      env.SEED_SYSTEM_CORPORATE_EMAIL = corporateEmail;
      await e2e.sql(
        `UPDATE public.usuarios SET email = :corporateEmail WHERE id = :id`,
        { corporateEmail, id: (await e2e.register('f7a-corporate')).id },
      );
    }, 60000);

    afterAll(() => {
      env.SEED_SYSTEM_CORPORATE_EMAIL = previousCorporateEmail;
    });

    it('lists the CORPORATE chat, never creates a TENANT_ADMIN one and does not list a legacy one', async () => {
      const gymAdmin = await legacyGymStaff(e2e, 'f7a-chat-admin', 'ADMIN', { tenantId: env.DEFAULT_TENANT_ID });
      const member = await e2e.register('f7a-chat-member');
      // A legacy, still open TENANT_ADMIN conversation of this member (as one created before franja 7a).
      const legacyId = randomUUID();
      await e2e.sql(`INSERT INTO chat.conversations (id, system_kind) VALUES (:legacyId, 'TENANT_ADMIN')`, { legacyId });
      await e2e.sql(
        `INSERT INTO chat.participants (conversation_id, user_id, can_write)
         VALUES (:legacyId, :memberId, false), (:legacyId, :adminId, true)`,
        { legacyId, memberId: member.id, adminId: gymAdmin.id },
      );

      const listed = await e2e.as(member.token).get('/me/conversations').expect(200);
      const kinds = (listed.body.data as { systemKind: string | null; conversationId: string }[]);
      expect(kinds.map((item) => item.systemKind)).toEqual(['CORPORATE']);
      expect(kinds.map((item) => item.conversationId)).not.toContain(legacyId);
      await e2e.as(member.token).get('/me/conversations').expect(200);

      const created = await sequelize.query<{ id: string }>(
        `SELECT c.id FROM chat.conversations c JOIN chat.participants p ON p.conversation_id = c.id
          WHERE p.user_id = :memberId AND c.system_kind = 'TENANT_ADMIN'`,
        { type: QueryTypes.SELECT, replacements: { memberId: member.id } },
      );
      expect(created.map((row) => row.id)).toEqual([legacyId]);
    }, 60000);
  });

  describe('migration 202611200301-revoke-tenant-admin-chats', () => {
    const revokedAtOf = async (id: string, transaction: Transaction) =>
      (await sequelize.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM chat.conversations WHERE id = :id', {
        type: QueryTypes.SELECT, replacements: { id }, transaction,
      }))[0].revoked_at;
    const ledgerExists = async (transaction: Transaction) =>
      (await sequelize.query<{ exists: boolean }>(
        `SELECT to_regclass('chat.tenant_admin_chat_revocations') IS NOT NULL AS exists`,
        { type: QueryTypes.SELECT, transaction },
      ))[0].exists;

    it('up revokes open TENANT_ADMIN chats only, down re-opens exactly those, up again revokes them again', async () => {
      const queryInterface = sequelize.getQueryInterface();
      const open = randomUUID();
      const revokedBefore = randomUUID();
      const corporate = randomUUID();
      const earlier = new Date('2026-01-02T03:04:05.000Z');
      // Rolled back at the end: the shared schema and its data are left as they were.
      const transaction = await sequelize.transaction();
      try {
        await revokeTenantAdminChatsMigration.down(queryInterface, transaction);
        expect(await ledgerExists(transaction)).toBe(false);
        await sequelize.query(
          `INSERT INTO chat.conversations (id, system_kind, revoked_at) VALUES
             (:open, 'TENANT_ADMIN', NULL), (:revokedBefore, 'TENANT_ADMIN', :earlier), (:corporate, 'CORPORATE', NULL)`,
          { replacements: { open, revokedBefore, corporate, earlier }, transaction },
        );

        await revokeTenantAdminChatsMigration.up(queryInterface, transaction);
        expect(await revokedAtOf(open, transaction)).not.toBeNull();
        expect(await revokedAtOf(revokedBefore, transaction)).toEqual(earlier);
        expect(await revokedAtOf(corporate, transaction)).toBeNull();

        await revokeTenantAdminChatsMigration.down(queryInterface, transaction);
        expect(await ledgerExists(transaction)).toBe(false);
        expect(await revokedAtOf(open, transaction)).toBeNull();
        expect(await revokedAtOf(revokedBefore, transaction)).toEqual(earlier);
        expect(await revokedAtOf(corporate, transaction)).toBeNull();

        await revokeTenantAdminChatsMigration.up(queryInterface, transaction);
        expect(await ledgerExists(transaction)).toBe(true);
        expect(await revokedAtOf(open, transaction)).not.toBeNull();
        expect(await revokedAtOf(revokedBefore, transaction)).toEqual(earlier);
        expect(await revokedAtOf(corporate, transaction)).toBeNull();
      } finally {
        await transaction.rollback();
      }
    }, 60000);
  });

});
