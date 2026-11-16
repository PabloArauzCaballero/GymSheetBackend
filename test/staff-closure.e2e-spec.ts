import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { Member } from './support/moderation-e2e';
import { selectRows, selectRowsEventually } from './support/privacy-e2e';

const PASSWORD = 'e2e-strong-password';

/**
 * I9: legacy gym staff accounts are closed by REPP. Since franja 7a (ADR-0019)
 * the gym has no staff powers, so `POST /admin/users/:id/close` is for the
 * platform `SYSTEM_ADMIN` (impersonating the gym, or across gyms). It runs the
 * closure erasure without password or PIN, audited, never for the operator's
 * own account or the gym's last admin, and without taking members' data
 * (assigned routines, chats with the gym) with it.
 */
describe('Staff account closure by REPP (e2e)', () => {
  let e2e: E2eApp;
  const gym = `staff-gym-${randomUUID().slice(0, 8)}`;
  const otherGym = `staff-other-${randomUUID().slice(0, 8)}`;
  let operator: Member;
  let admin: Member;
  let secondAdmin: Member;
  let coach: Member;
  let frontDesk: Member;
  let member: Member;
  let foreignCoach: Member;

  const emailOf = async (id: string) =>
    (await selectRows<{ email: string }>(e2e, 'SELECT email FROM public.usuarios WHERE id = :id', { id }))[0].email;
  const staff = async (label: string, role: string, tenantId: string) => {
    const account = await e2e.register(label);
    await e2e.sql('UPDATE public.usuarios SET rol = :role, tenant_id = :tenantId WHERE id = :id', { role, tenantId, id: account.id });
    return account;
  };
  const close = (actor: Member, userId: string) => e2e.as(actor.token).post(`/admin/users/${userId}/close`);

  beforeAll(async () => {
    e2e = await bootE2eApp();
    for (const id of [gym, otherGym]) {
      await e2e.sql(`INSERT INTO public.tenants (id, nombre, estado) VALUES (:id, :id, 'ACTIVO')`, { id });
    }
    admin = await staff('staff-admin', 'ADMIN', gym);
    secondAdmin = await staff('staff-admin-2', 'ADMIN', gym);
    coach = await staff('staff-coach', 'COACH', gym);
    frontDesk = await staff('staff-desk', 'FRONT_DESK', gym);
    member = await staff('staff-member', 'CLIENTE', gym);
    foreignCoach = await staff('staff-foreign', 'COACH', otherGym);
    const platform = await e2e.platformAdmin('staff-operator');
    operator = { id: platform.id, token: await e2e.impersonate(platform.token, gym) };
  }, 60000);
  afterAll(async () => e2e?.app.close());

  it("is for REPP only (not even the gym's legacy admin), and needs a session", async () => {
    await close(coach, frontDesk.id).expect(403);
    await close(member, frontDesk.id).expect(403);
    await close(admin, frontDesk.id).expect(403);
    await request(e2e.http).post(e2e.url(`/admin/users/${frontDesk.id}/close`)).expect(401);
    await close(operator, 'not-a-uuid').expect(400);
    const [account] = await selectRows<{ closed_at: Date | null }>(e2e, 'SELECT closed_at FROM public.usuarios WHERE id = :id', { id: frontDesk.id });
    expect(account.closed_at).toBeNull();
  });

  it("answers 404 for another gym's account and refuses a member and the operator's own account", async () => {
    await close(operator, foreignCoach.id).expect(404);
    const memberRefusal = await close(operator, member.id).expect(400);
    expect(memberRefusal.body.code).toBe('STAFF_CLOSURE_NOT_STAFF');
    const self = await close(operator, operator.id).expect(403);
    expect(self.body.code).toBe('STAFF_CLOSURE_SELF');
    for (const id of [foreignCoach.id, member.id, operator.id]) {
      const [account] = await selectRows<{ closed_at: Date | null }>(e2e, 'SELECT closed_at FROM public.usuarios WHERE id = :id', { id });
      expect(account.closed_at).toBeNull();
    }
  });

  it("closes a coach: the account is erased and audited, the members' assigned routines stay", async () => {
    const email = await emailOf(coach.id);
    const routineId = randomUUID();
    const assignmentId = randomUUID();
    await e2e.sql(`INSERT INTO training.routines (id, nombre, created_by_user_id) VALUES (:routineId, 'Plan del coach', :coachId)`,
      { routineId, coachId: coach.id });
    await e2e.sql(`INSERT INTO training.routine_assignments (id, routine_id, cliente_user_id, asignado_por_user_id)
                   VALUES (:assignmentId, :routineId, :memberId, :coachId)`,
    { assignmentId, routineId, memberId: member.id, coachId: coach.id });
    await e2e.sql(`INSERT INTO membership.staff_profiles (id, user_id, position, hired_on) VALUES (:id, :userId, 'COACH', '2025-01-01')`,
      { id: randomUUID(), userId: coach.id });

    const closed = await close(operator, coach.id).expect(200);
    expect(closed.body.data).toMatchObject({ closed: true });
    expect(typeof closed.body.data.closedAt).toBe('string');

    const [account] = await selectRows<{ email: string; estado: string; closed_at: Date | null }>(e2e,
      'SELECT email, estado, closed_at FROM public.usuarios WHERE id = :id', { id: coach.id });
    expect(account).toMatchObject({ email: `cerrada-${coach.id}@cuenta-cerrada.invalid`, estado: 'INACTIVO' });
    expect(account.closed_at).not.toBeNull();
    await e2e.as(coach.token).get('/users/me').expect(401);
    await request(e2e.http).post(e2e.url('/auth/login')).send({ email, password: PASSWORD }).expect(401);
    const [profile] = await selectRows<{ employment_status: string }>(e2e,
      'SELECT employment_status FROM membership.staff_profiles WHERE user_id = :id', { id: coach.id });
    expect(profile.employment_status).toBe('TERMINATED');
    expect(await selectRows(e2e, 'SELECT 1 FROM training.routine_assignments WHERE id = :id', { id: assignmentId })).toHaveLength(1);
    expect(await selectRows(e2e, 'SELECT 1 FROM training.routines WHERE id = :id', { id: routineId })).toHaveLength(1);

    const audit = await selectRowsEventually<{ actor_user_id: string; action: string }>(e2e,
      `SELECT actor_user_id, action FROM admin.audit_log WHERE domain = 'account' AND target_id = :id`, { id: coach.id });
    expect(audit).toEqual([{ actor_user_id: operator.id, action: 'close' }]);

    // Already closed: nothing left to close.
    await close(operator, coach.id).expect(404);
  });

  it("closes another admin while the gym keeps one; the members' chat with the gym stays theirs", async () => {
    const conversationId = randomUUID();
    await e2e.sql(`INSERT INTO chat.conversations (id, system_kind) VALUES (:conversationId, 'TENANT_ADMIN')`, { conversationId });
    await e2e.sql(`INSERT INTO chat.participants (conversation_id, user_id, can_write)
                   VALUES (:conversationId, :memberId, false), (:conversationId, :adminId, true)`,
    { conversationId, memberId: member.id, adminId: secondAdmin.id });

    await close(operator, secondAdmin.id).expect(200);
    expect(await selectRows(e2e, 'SELECT 1 FROM chat.conversations WHERE id = :id', { id: conversationId })).toHaveLength(1);
    expect(await selectRows(e2e, 'SELECT 1 FROM chat.participants WHERE conversation_id = :id AND user_id = :memberId',
      { id: conversationId, memberId: member.id })).toHaveLength(1);
  });

  it('never closes the last admin of a gym, not even for a platform admin', async () => {
    const platform = await e2e.platformAdmin('staff-platform');
    const refused = await close(platform, admin.id).expect(403);
    expect(refused.body.code).toBe('STAFF_CLOSURE_LAST_ADMIN');
    // The platform admin does reach other gyms' staff.
    await close(platform, foreignCoach.id).expect(200);
  });
});
