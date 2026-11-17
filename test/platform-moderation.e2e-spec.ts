import { randomUUID } from 'node:crypto';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { inbox, Member, registerModerator } from './support/moderation-e2e';
import { selectRows, selectRowsEventually } from './support/privacy-e2e';

type AuditRow = {
  actor_user_id: string;
  actor_role: string;
  tenant_scope: string | null;
  target_id: string;
  metadata: Record<string, unknown>;
};

/**
 * ADR-0018: social moderation belongs to the central REPP team. A platform
 * MODERATOR works the queue of every gym and every decision is audited with
 * its id; gym staff (ADMIN, FRONT_DESK) is refused, even with the retired
 * `moderation:*` grants; only SYSTEM_ADMIN makes or revokes moderators.
 */
describe('Platform moderation (e2e)', () => {
  let e2e: E2eApp;
  let platformAdmin: Member;
  let gymB: string;
  let gymAdmin: Member;
  let frontDesk: Member;

  const audit = (action: string, targetId: string) =>
    selectRowsEventually<AuditRow>(e2e,
      `SELECT actor_user_id, actor_role, tenant_scope, target_id, metadata FROM admin.audit_log
        WHERE domain = 'moderation' AND action = :action AND target_id = :targetId`, { action, targetId });
  /** A member of gym B reported by another member of gym B. */
  const reportedInGymB = async (label: string) => {
    const author = await e2e.register(`${label}-author`);
    const reporter = await e2e.register(`${label}-reporter`);
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :gymB WHERE id IN (:ids)', { gymB, ids: [author.id, reporter.id] });
    await e2e.as(reporter.token).post('/me/reports').send({ targetKind: 'USER', targetId: author.id, reason: 'SPAM' }).expect(201);
    return author;
  };

  type QueueItem = { target_id: string; reported_user_id: string; tenant_id: string; tenant_name: string | null };
  /** The whole queue the member sees: the suites share one database, so walk it instead of assuming page 1. */
  const queueOf = async (member: Member) => {
    const items: QueueItem[] = [];
    for (let page = 1; page <= 40; page += 1) {
      const queue = await e2e.as(member.token).get(`/admin/moderation/queue?pageSize=50&page=${page}`).expect(200);
      items.push(...(queue.body.data as QueueItem[]));
      if ((queue.body.data as unknown[]).length < 50) break;
    }
    return items;
  };
  /** Someone reports the account itself, for being a minor: the case that can erase it. */
  const reportAccount = async (label: string, target: Member) => {
    const reporter = await e2e.register(label);
    await e2e.as(reporter.token).post('/me/reports').send({ targetKind: 'USER', targetId: target.id, reason: 'MENOR_DE_EDAD' }).expect(201);
  };
  /** Five strikes still counting: the next sanction of the account is the expulsion. */
  const nextSanctionExpels = (userId: string) => e2e.sql(
    `INSERT INTO moderation.user_strikes (id, user_id, tenant_id, kind, reason, expires_at)
     SELECT gen_random_uuid(), :userId, 'default', 'ADVERTENCIA', 'SPAM', now() + interval '300 days' FROM generate_series(1, 5)`,
    { userId });
  /** Nothing was decided on the account: the case is open, the account active, no strike, no minor closure. */
  const expectUntouched = async (userId: string, strikesBefore: number) => {
    const [account] = await selectRows<{ estado: string; suspended: boolean; strikes: number; closures: number }>(e2e,
      `SELECT u.estado, (u.suspended_until > now()) IS TRUE AS suspended,
              (SELECT count(*)::int FROM moderation.user_strikes s WHERE s.user_id = u.id) AS strikes,
              (SELECT count(*)::int FROM integration.outbox_jobs o
                WHERE o.queue_name = 'account.minor-closure' AND o.aggregate_id = u.id) AS closures
         FROM public.usuarios u WHERE u.id = :userId`, { userId });
    expect(account).toEqual({ estado: 'ACTIVO', suspended: false, strikes: strikesBefore, closures: 0 });
    const reports = await selectRows<{ status: string }>(e2e,
      `SELECT DISTINCT status FROM moderation.reports WHERE target_kind = 'USER' AND target_id = :userId`, { userId });
    expect(reports).toEqual([{ status: 'PENDIENTE' }]);
  };
  const refusedWith = async (member: Member, targetId: string, code: string) => {
    const base = `/admin/moderation/cases/USER/${targetId}`;
    const api = e2e.as(member.token);
    expect((await api.get(base).expect(403)).body.code).toBe(code);
    expect((await api.post(`${base}/claim`).expect(403)).body.code).toBe(code);
    for (const decision of [{ sanction: true, hideContent: false }, { sanction: false, hideContent: false, confirmMinor: true }]) {
      expect((await api.post(`${base}/resolve`).send(decision).expect(403)).body.code).toBe(code);
    }
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();
    gymB = `platform-mod-${randomUUID().slice(0, 8)}`;
    await e2e.sql('INSERT INTO public.tenants (id, nombre) VALUES (:gymB, :name)', { gymB, name: 'Gimnasio B' });
    platformAdmin = await e2e.register('platform-mod-sys');
    await e2e.promote(platformAdmin.id, 'SYSTEM_ADMIN');
    gymAdmin = await e2e.register('platform-mod-gym-admin');
    frontDesk = await e2e.register('platform-mod-front-desk');
    // Gym B's former staff: members since franja 7d (ADR-0029), they moderate nothing.
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :gymB WHERE id IN (:ids)', { gymB, ids: [gymAdmin.id, frontDesk.id] });
  }, 60000);
  afterAll(async () => e2e?.app.close());

  it('only SYSTEM_ADMIN makes and lists moderators, and only out of member accounts', async () => {
    const candidate = await e2e.register('platform-mod-candidate');
    for (const caller of [gymAdmin, frontDesk, candidate]) {
      await e2e.as(caller.token).put(`/admin/platform/moderators/${candidate.id}`).expect(403);
      await e2e.as(caller.token).get('/admin/platform/moderators').expect(403);
    }
    // A platform account cannot wear both hats.
    const refused = await e2e.as(platformAdmin.token).put(`/admin/platform/moderators/${platformAdmin.id}`).expect(409);
    expect(refused.body.code).toBe('MODERATOR_NOT_ASSIGNABLE');
    await e2e.as(platformAdmin.token).put(`/admin/platform/moderators/${randomUUID()}`).expect(404);

    const assigned = await e2e.as(platformAdmin.token).put(`/admin/platform/moderators/${candidate.id}`).expect(200);
    expect(assigned.body.data).toMatchObject({ id: candidate.id, estado: 'ACTIVO' });
    await e2e.as(platformAdmin.token).put(`/admin/platform/moderators/${candidate.id}`).expect(200);
    const listed = await e2e.as(platformAdmin.token).get('/admin/platform/moderators').expect(200);
    expect(listed.body.data.map((row: { id: string }) => row.id)).toContain(candidate.id);
    const [row] = await audit('moderator-assign', candidate.id);
    expect(row).toMatchObject({ actor_user_id: platformAdmin.id, actor_role: 'SYSTEM_ADMIN' });
    // A moderator cannot make moderators either.
    await e2e.as(candidate.token).put(`/admin/platform/moderators/${gymAdmin.id}`).expect(403);
  });

  it('a platform moderator sees the queue of every gym with its gym, decides, and the decision is audited', async () => {
    const moderator = await registerModerator(e2e, 'platform-mod-central');
    const authorB = await reportedInGymB('platform-mod-b');
    const authorDefault = await e2e.register('platform-mod-default-author');
    const reporterDefault = await e2e.register('platform-mod-default-reporter');
    await e2e.as(reporterDefault.token).post('/me/reports')
      .send({ targetKind: 'USER', targetId: authorDefault.id, reason: 'SPAM' }).expect(201);

    // The queue rows are snake_case, as the console has always read them.
    const items = await queueOf(moderator);
    expect(items.find((item) => item.target_id === authorB.id)).toMatchObject({ tenant_id: gymB, tenant_name: 'Gimnasio B' });
    expect(items.find((item) => item.target_id === authorDefault.id)).toMatchObject({ tenant_id: 'default' });

    const kase = await e2e.as(moderator.token).get(`/admin/moderation/cases/USER/${authorB.id}`).expect(200);
    expect(kase.body.data).toMatchObject({ tenantId: gymB, pendingSanction: { kind: 'ADVERTENCIA' } });
    await e2e.as(moderator.token).post(`/admin/moderation/cases/USER/${authorB.id}/claim`).expect(201);
    const verdict = await e2e.as(moderator.token).post(`/admin/moderation/cases/USER/${authorB.id}/resolve`)
      .send({ sanction: true, hideContent: false, note: 'Revisión central' }).expect(201);
    expect(verdict.body.data).toMatchObject({ resolved: true, tenantId: gymB, resolution: 'USUARIO_ADVERTIDO', sanction: { kind: 'ADVERTENCIA' } });

    const [row] = await audit('resolve', authorB.id);
    expect(row).toMatchObject({
      actor_user_id: moderator.id,
      actor_role: 'MODERATOR',
      tenant_scope: null,
      metadata: { caseKind: 'USER', tenantId: gymB, resolution: 'USUARIO_ADVERTIDO', sanction: 'ADVERTENCIA', reportsClosed: 1 },
    });
    const [claim] = await audit('claim', authorB.id);
    expect(claim).toMatchObject({ actor_user_id: moderator.id, tenant_scope: null });
    const history = await e2e.as(moderator.token).get(`/admin/moderation/users/${authorB.id}/history`).expect(200);
    expect(history.body.data.activeStrikes).toBe(1);

    // The person learns that REPP decided, not the gym.
    const notices = await inbox(e2e, authorB.token);
    const notice = notices.find((item) => item.tipo === 'MODERATION_SANCTION');
    expect(notice?.mensaje).toContain('equipo de moderación de REPP');
    expect(notice?.mensaje).not.toMatch(/gimnasio/iu);
  });

  it("gym B's former ADMIN and FRONT_DESK (members since ADR-0029) are refused on every moderation surface", async () => {
    const author = await reportedInGymB('platform-mod-refused');
    const base = `/admin/moderation/cases/USER/${author.id}`;
    for (const staff of [gymAdmin, frontDesk]) {
      const api = e2e.as(staff.token);
      await api.get('/admin/moderation/queue').expect(403);
      await api.get(base).expect(403);
      await api.post(`${base}/claim`).expect(403);
      await api.post(`${base}/release`).expect(403);
      await api.post(`${base}/resolve`).send({ sanction: true, hideContent: false }).expect(403);
      await api.get(`/admin/moderation/users/${author.id}/history`).expect(403);
      await api.get('/admin/signups').expect(403);
      await api.get('/admin/routines').expect(403);
    }
    const open = await selectRows<{ status: string }>(e2e,
      `SELECT status FROM moderation.reports WHERE target_kind = 'USER' AND target_id = :id`, { id: author.id });
    expect(open).toEqual([{ status: 'PENDIENTE' }]);
    const keys = await e2e.as(platformAdmin.token).get('/admin/permissions/me').expect(200);
    expect(JSON.stringify(keys.body.data)).not.toContain('moderation:');
  });

  it('revoking a moderator closes the console to it and frees the cases it had claimed', async () => {
    const moderator = await registerModerator(e2e, 'platform-mod-revoked');
    const author = await reportedInGymB('platform-mod-claimed');
    await e2e.as(moderator.token).post(`/admin/moderation/cases/USER/${author.id}/claim`).expect(201);

    await e2e.as(gymAdmin.token).del(`/admin/platform/moderators/${moderator.id}`).expect(403);
    await e2e.as(platformAdmin.token).del(`/admin/platform/moderators/${moderator.id}`).expect(204);
    await e2e.as(platformAdmin.token).del(`/admin/platform/moderators/${moderator.id}`).expect(404);
    await e2e.as(moderator.token).get('/admin/moderation/queue').expect(403);
    const reports = await selectRows<{ status: string; claimed: string | null }>(e2e,
      `SELECT status, claimed_by_user_id AS claimed FROM moderation.reports WHERE target_kind = 'USER' AND target_id = :id`,
      { id: author.id });
    expect(reports).toEqual([{ status: 'PENDIENTE', claimed: null }]);
    const [row] = await audit('moderator-revoke', moderator.id);
    expect(row).toMatchObject({ actor_user_id: platformAdmin.id });
  });

  it('nobody acts on a case about their own account, and it is not in their queue', async () => {
    const moderator = await registerModerator(e2e, 'platform-mod-self');
    const admin = await e2e.register('platform-mod-self-sys');
    await e2e.promote(admin.id, 'SYSTEM_ADMIN');
    for (const member of [moderator, admin]) {
      await reportAccount(`platform-mod-self-reporter-${member.id.slice(0, 6)}`, member);
      await nextSanctionExpels(member.id);
      expect((await queueOf(member)).map((item) => item.reported_user_id)).not.toContain(member.id);
      await refusedWith(member, member.id, 'MODERATION_SELF_CASE');
      await expectUntouched(member.id, 5);
    }
  });

  it('a moderator cannot act on, nor see, a case about another moderator or a SYSTEM_ADMIN; a SYSTEM_ADMIN decides it', async () => {
    const moderator = await registerModerator(e2e, 'platform-mod-peer-actor');
    const peer = await registerModerator(e2e, 'platform-mod-peer-target');
    const admin = await e2e.register('platform-mod-peer-sys');
    await e2e.promote(admin.id, 'SYSTEM_ADMIN');
    for (const target of [peer, admin]) {
      await reportAccount(`platform-mod-peer-reporter-${target.id.slice(0, 6)}`, target);
      await nextSanctionExpels(target.id);
    }

    const seen = (await queueOf(moderator)).map((item) => item.reported_user_id);
    expect(seen).not.toContain(peer.id);
    expect(seen).not.toContain(admin.id);
    for (const target of [peer, admin]) {
      await refusedWith(moderator, target.id, 'MODERATION_PEER_CASE');
      await expectUntouched(target.id, 5);
    }

    // The platform administrator sees the peer case and decides it.
    expect((await queueOf(platformAdmin)).map((item) => item.reported_user_id)).toContain(peer.id);
    const base = `/admin/moderation/cases/USER/${peer.id}`;
    await e2e.as(platformAdmin.token).post(`${base}/claim`).expect(201);
    const verdict = await e2e.as(platformAdmin.token).post(`${base}/resolve`).send({ sanction: true, hideContent: false }).expect(201);
    expect(verdict.body.data).toMatchObject({ resolution: 'USUARIO_EXPULSADO', sanction: { kind: 'EXPULSION' } });
    const [account] = await selectRows<{ estado: string }>(e2e, 'SELECT estado FROM public.usuarios WHERE id = :id', { id: peer.id });
    expect(account).toEqual({ estado: 'INACTIVO' });
  });
});
