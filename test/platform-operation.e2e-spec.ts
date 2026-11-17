import { randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env';
import { revokeTenantAdminChatsMigration } from '../src/database/migrations/202611200301-revoke-tenant-admin-chats';
import { retireTenantAdminChatsMigration } from '../src/database/migrations/202611201303-retire-tenant-admin-chats';
import { businessNameSkeleton } from '../src/modules/business-accounts/handle-rules';
import { bootE2eApp, createPersonalExercise, E2eApp } from './support/e2e-app';

/**
 * Franja 7a (ADR-0019): REPP operates the platform and the gym has no staff:
 * every `admin/*` route is REPP's, the coach assignment routes are gone, and
 * the pinned gym admin chat no longer exists. Franja 7d (ADR-0029) removed the
 * staff roles (their accounts are members now), the permission grants and the
 * staff closure route.
 */
describe('REPP operates the platform; the gym has no staff (e2e, franjas 7a and 7d)', () => {
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
    ['get', '/admin/media'],
    ['post', '/admin/notifications/broadcast', {}],
    ['get', '/admin/facilities/branches'],
    ['post', '/admin/facilities/branches', {}],
    ['get', '/admin/tenants'],
    ['get', '/admin/signups'],
    ['get', '/admin/audit'],
    ['get', '/admin/permissions/me'],
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
    it('a member account (what every former staff account is since franja 7d) gets 403 on every admin/* route', async () => {
      const formerStaff = await e2e.register('f7d-former-staff');
      const admitted: string[] = [];
      for (const route of adminRoutes) {
        const response = await call(formerStaff.token, route);
        if (response.status !== 403) admitted.push(`${route[0]} ${route[1]} -> ${response.status}`);
      }
      expect(admitted).toEqual([]);
    }, 60000);

    it('the staff closure and the permission grant routes are gone (404), even for SYSTEM_ADMIN (franja 7d)', async () => {
      const retired: Route[] = [
        ['post', `/admin/users/${uuid}/close`],
        ['get', '/admin/permissions/catalog'],
        ['get', `/admin/permissions/${uuid}`],
        ['post', `/admin/permissions/${uuid}`, { permissionKey: 'support:read' }],
        ['del', `/admin/permissions/${uuid}/support:read`],
      ];
      const answered: string[] = [];
      for (const route of retired) {
        const response = await call(platform.token, route);
        if (response.status !== 404) answered.push(`${route[0]} ${route[1]} -> ${response.status}`);
      }
      expect(answered).toEqual([]);
      const keys = await e2e.as(platform.token).get('/admin/permissions/me').expect(200);
      expect(keys.body.data.permissionKeys).toEqual(expect.arrayContaining(['support:read', 'admin-access:manage']));
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

    it("a member of the listing's gym who does not own it gets 404 on its payments and 403 replying", async () => {
      const staff = await e2e.register('f7a-dir-member');
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
      const coach = await e2e.register('f7a-assigner');
      const gymAdmin = await e2e.register('f7a-assigner-member');
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

    it('lists only the CORPORATE chat, and the database refuses a TENANT_ADMIN one (franja 7d)', async () => {
      const member = await e2e.register('f7a-chat-member');
      const listed = await e2e.as(member.token).get('/me/conversations').expect(200);
      expect((listed.body.data as { systemKind: string | null }[]).map((item) => item.systemKind)).toEqual(['CORPORATE']);
      await expect(
        e2e.sql(`INSERT INTO chat.conversations (id, kind, system_kind) VALUES (:id, 'SYSTEM', 'TENANT_ADMIN')`, { id: randomUUID() }),
      ).rejects.toThrow(/ck_chat_conversations_system_kind/u);
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
        // Franja 7d moved the ledger and the chats to `retired`: undo it first, redo it last.
        await retireTenantAdminChatsMigration.down(queryInterface, transaction);
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
        await retireTenantAdminChatsMigration.up(queryInterface, transaction);
        expect(await ledgerExists(transaction)).toBe(false);
      } finally {
        await transaction.rollback();
      }
    }, 60000);
  });

});
