import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";
import "./entrenar-juntos-migrations.e2e";

describe("H10 training invitations (PostgreSQL e2e)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let sequelize: Sequelize;
  const userIds: string[] = [];
  const connectionIds: string[] = [];
  let blockedConnectionId: string | undefined;
  let branchId: string | undefined;
  let temporaryTenantId: string | undefined;
  const temporaryExerciseIds: string[] = [];
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    if (
      env.DB_NAME !== "gymsheet_social_qa" ||
      !["127.0.0.1", "localhost"].includes(env.DB_HOST) ||
      Number(env.DB_PORT) !== 55432
    ) {
      throw new Error(
        "H10 training invitations E2E runs only against the isolated local gymsheet_social_qa database.",
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    sequelize = moduleRef.get(Sequelize);
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(
      urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }),
    );
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();
  }, 60000);

  afterAll(async () => {
    const failures: string[] = [];
    const attempt = async (label: string, work: () => Promise<unknown>) => {
      try {
        await work();
      } catch (error) {
        failures.push(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    try {
      if (sequelize) {
        if (userIds.length) {
          await attempt("delete invitations", () =>
            sequelize.query(
              `DELETE FROM training.training_invites
                WHERE inviter_id IN (:userIds) OR recipient_id IN (:userIds)`,
              { replacements: { userIds } },
            ),
          );
          await attempt("delete test chat conversations", () =>
            sequelize.query(
              `DELETE FROM chat.conversations
                WHERE id IN (
                  SELECT DISTINCT conversation_id FROM chat.participants
                   WHERE user_id IN (:userIds)
                )`,
              { replacements: { userIds } },
            ),
          );
        }
        const trackedConnectionIds = [
          ...connectionIds,
          blockedConnectionId,
        ].filter((id): id is string => Boolean(id));
        if (trackedConnectionIds.length) {
          await attempt("delete connections", () =>
            sequelize.query(
              "DELETE FROM social.connections WHERE id IN (:connectionIds)",
              { replacements: { connectionIds: trackedConnectionIds } },
            ),
          );
        }
        if (branchId) {
          await attempt("delete test branch", () =>
            sequelize.query(
              "DELETE FROM facilities.branches WHERE id = :branchId",
              { replacements: { branchId } },
            ),
          );
        }
        if (temporaryTenantId) {
          await attempt("delete test tenant", () =>
            sequelize.query("DELETE FROM public.tenants WHERE id = :tenantId", {
              replacements: { tenantId: temporaryTenantId },
            }),
          );
        }
        if (userIds.length) {
          await attempt("delete test users", () =>
            sequelize.query(
              "DELETE FROM public.usuarios WHERE id IN (:userIds)",
              {
                replacements: { userIds },
              },
            ),
          );
          await attempt("verify users removed", async () => {
            const rows = await sequelize.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM public.usuarios WHERE id IN (:userIds)",
              { type: QueryTypes.SELECT, replacements: { userIds } },
            );
            expect(rows[0].count).toBe("0");
          });
          await attempt("verify invitations removed", async () => {
            const rows = await sequelize.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM training.training_invites
                WHERE inviter_id IN (:userIds) OR recipient_id IN (:userIds)`,
              { type: QueryTypes.SELECT, replacements: { userIds } },
            );
            expect(rows[0].count).toBe("0");
          });
          await attempt("verify blocks removed", async () => {
            const rows = await sequelize.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM social.user_blocks
                WHERE blocker_id IN (:userIds) OR blocked_id IN (:userIds)`,
              { type: QueryTypes.SELECT, replacements: { userIds } },
            );
            expect(rows[0].count).toBe("0");
          });
        }
        if (temporaryExerciseIds.length) {
          await attempt("delete test exercise", () =>
            sequelize.query(
              "DELETE FROM public.ejercicios WHERE id IN (:ids)",
              {
                replacements: { ids: temporaryExerciseIds },
              },
            ),
          );
        }
        if (trackedConnectionIds.length) {
          await attempt("verify connections removed", async () => {
            const rows = await sequelize.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM social.connections WHERE id IN (:connectionIds)",
              {
                type: QueryTypes.SELECT,
                replacements: { connectionIds: trackedConnectionIds },
              },
            );
            expect(rows[0].count).toBe("0");
          });
        }
        if (branchId) {
          await attempt("verify branch removed", async () => {
            const rows = await sequelize.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM facilities.branches WHERE id = :branchId",
              { type: QueryTypes.SELECT, replacements: { branchId } },
            );
            expect(rows[0].count).toBe("0");
          });
        }
        if (temporaryTenantId) {
          await attempt("verify tenant removed", async () => {
            const rows = await sequelize.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM public.tenants WHERE id = :tenantId",
              {
                type: QueryTypes.SELECT,
                replacements: { tenantId: temporaryTenantId },
              },
            );
            expect(rows[0].count).toBe("0");
          });
        }
      }
    } finally {
      await attempt("close application", async () => application?.close());
    }
    if (failures.length) {
      throw new Error(`H10 E2E cleanup failed:\n${failures.join("\n")}`);
    }
  });

  it("H10.S1.M3: acceptance atomically creates one meeting and visible chat event", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-invite-${label}-${suffix}@example.test`,
          password: "h10-invite-qa-password",
          nombreCompleto: `H10 Invite ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const stranger = await register("c");
    const suffixId = randomUUID().replaceAll("-", "");
    temporaryTenantId = `h10-other-${suffixId}`;
    await sequelize.query(
      `INSERT INTO public.tenants (id, nombre, estado)
       VALUES (:tenantId, 'H10 Other Tenant', 'ACTIVO')`,
      { replacements: { tenantId: temporaryTenantId } },
    );
    branchId = randomUUID();
    await sequelize.query(
      `INSERT INTO facilities.branches (id, code, name, time_zone, tenant_id, status)
       VALUES (:id, :code, :name, 'America/La_Paz', :tenantId, 'ACTIVE')`,
      {
        replacements: {
          id: branchId,
          code: `h10-${suffixId}`,
          name: `H10 Other Tenant Gym ${suffix}`,
          tenantId: temporaryTenantId,
        },
      },
    );
    await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: stranger.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        clientRequestId: randomUUID(),
      })
      .expect(403);

    const rejectedInvites = await sequelize.query<{
      invite_count: string;
      revision_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM training.training_invites
           WHERE inviter_id = :inviterId AND recipient_id = :recipientId) AS invite_count,
         (SELECT count(*)::text FROM training.training_invite_revisions r
           JOIN training.training_invites i ON i.id = r.invite_id
          WHERE i.inviter_id = :inviterId AND i.recipient_id = :recipientId) AS revision_count`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: stranger.userId,
        },
      },
    );
    expect(rejectedInvites[0]).toEqual({
      invite_count: "0",
      revision_count: "0",
    });

    const [blockedConnection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :strangerId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          strangerId: stranger.userId,
        },
      },
    );
    blockedConnectionId = blockedConnection.id;
    await sequelize.query(
      `INSERT INTO social.user_blocks (blocker_id, blocked_id)
       VALUES (:strangerId, :inviterId)`,
      {
        replacements: {
          strangerId: stranger.userId,
          inviterId: inviter.userId,
        },
      },
    );
    await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: stranger.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        clientRequestId: randomUUID(),
      })
      .expect(403);
    const blockedInviteCount = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM training.training_invites
        WHERE inviter_id = :inviterId AND recipient_id = :recipientId`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: stranger.userId,
        },
      },
    );
    expect(blockedInviteCount[0].count).toBe("0");

    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "GYM", placeId: branchId, label: "Other tenant gym" },
        clientRequestId: randomUUID(),
      })
      .expect(404);

    const clientRequestId = randomUUID();
    const payload = {
      recipientId: recipient.userId,
      startsAt: "2030-05-01T18:30:00-04:00",
      timeZone: "America/New_York",
      durationMinutes: 75,
      place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
      clientRequestId,
    };
    const created = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send(payload)
      .expect(201);

    expect(created.body.data).toMatchObject({
      state: "PENDING",
      currentRevision: 1,
      participants: [inviter.userId, recipient.userId],
      revisions: [
        {
          startsAt: "2030-05-01T22:30:00.000Z",
          timeZone: "America/New_York",
          durationMinutes: 75,
          place: {
            kind: "PUBLIC_PLACE",
            label: "Parque Central",
          },
          mode: "OWN_ROUTINES",
        },
      ],
    });

    const replay = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send(payload)
      .expect(201);
    expect(replay.body.data.id).toBe(created.body.data.id);

    const changedReplay = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({ ...payload, durationMinutes: 90 })
      .expect(409);
    expect(changedReplay.body.data).toBeUndefined();

    const persisted = await sequelize.query<{
      invite_count: string;
      revision_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM training.training_invites WHERE id = :inviteId) AS invite_count,
         (SELECT count(*)::text FROM training.training_invite_revisions WHERE invite_id = :inviteId) AS revision_count`,
      {
        type: QueryTypes.SELECT,
        replacements: { inviteId: created.body.data.id },
      },
    );
    expect(persisted[0]).toEqual({ invite_count: "1", revision_count: "1" });

    const inviteId = created.body.data.id as string;
    await expect(
      sequelize.query(
        `UPDATE training.training_invites SET state = 'ACCEPTED'
          WHERE id = :inviteId`,
        { replacements: { inviteId } },
      ),
    ).rejects.toThrow(/ck_training_invite_response_state/i);
    await expect(
      sequelize.query(
        `UPDATE training.training_invites
            SET responded_by_user_id = :recipientId, responded_revision = 1,
                responded_at = now()
          WHERE id = :inviteId`,
        { replacements: { inviteId, recipientId: recipient.userId } },
      ),
    ).rejects.toThrow(/ck_training_invite_response_state/i);

    const responsePayload = {
      decision: "ACCEPT",
      expectedRevision: 1,
      clientRequestId: randomUUID(),
    };
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send(responsePayload)
      .expect(409);
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send(responsePayload)
      .expect(404);
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ ...responsePayload, expectedRevision: 2 })
      .expect(409);

    await sequelize.query(
      `CREATE OR REPLACE FUNCTION chat.reject_training_event_for_test()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced H10 M3 rollback'; END
       $$`,
    );
    await sequelize.query(
      `CREATE TRIGGER trg_reject_training_event_for_test
       BEFORE INSERT ON chat.conversation_events
       FOR EACH ROW EXECUTE FUNCTION chat.reject_training_event_for_test()`,
    );
    try {
      await request(httpServer)
        .post(url(`/me/training-invitations/${inviteId}/respond`))
        .set("Authorization", `Bearer ${recipient.accessToken}`)
        .send({ ...responsePayload, clientRequestId: randomUUID() })
        .expect(500);
      const rollbackState = await sequelize.query<{
        invite_state: string;
        command_count: string;
        meeting_count: string;
        event_count: string;
        conversation_count: string;
      }>(
        `SELECT
           (SELECT state FROM training.training_invites WHERE id = :inviteId) AS invite_state,
           (SELECT count(*)::text FROM training.training_invite_commands
             WHERE invite_id = :inviteId) AS command_count,
           (SELECT count(*)::text FROM training.training_invite_meetings
             WHERE invite_id = :inviteId) AS meeting_count,
           (SELECT count(*)::text FROM chat.conversation_events
             WHERE invitation_id = :inviteId) AS event_count,
           (SELECT count(*)::text FROM chat.conversations c
             WHERE c.id IN (
               SELECT p1.conversation_id FROM chat.participants p1
               JOIN chat.participants p2 ON p2.conversation_id = p1.conversation_id
               WHERE p1.user_id = :inviterId AND p2.user_id = :recipientId
             )) AS conversation_count`,
        {
          type: QueryTypes.SELECT,
          replacements: {
            inviteId,
            inviterId: inviter.userId,
            recipientId: recipient.userId,
          },
        },
      );
      expect(rollbackState[0]).toEqual({
        invite_state: "PENDING",
        command_count: "0",
        meeting_count: "0",
        event_count: "0",
        conversation_count: "0",
      });
    } finally {
      await sequelize.query(
        "DROP TRIGGER IF EXISTS trg_reject_training_event_for_test ON chat.conversation_events",
      );
      await sequelize.query(
        "DROP FUNCTION IF EXISTS chat.reject_training_event_for_test()",
      );
    }

    await expect(
      sequelize.query(
        `UPDATE training.training_invite_revisions SET note = 'tampered'
          WHERE invite_id = :inviteId AND revision = 1`,
        { replacements: { inviteId } },
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      sequelize.query(
        `DELETE FROM training.training_invite_revisions
          WHERE invite_id = :inviteId AND revision = 1`,
        { replacements: { inviteId } },
      ),
    ).rejects.toThrow(/cascade cleanup/i);

    const concurrentResponses = await Promise.all([
      request(httpServer)
        .post(url(`/me/training-invitations/${inviteId}/respond`))
        .set("Authorization", `Bearer ${recipient.accessToken}`)
        .send(responsePayload),
      request(httpServer)
        .post(url(`/me/training-invitations/${inviteId}/respond`))
        .set("Authorization", `Bearer ${recipient.accessToken}`)
        .send(responsePayload),
    ]);
    expect(concurrentResponses.map(({ status }) => status)).toEqual([200, 200]);
    expect(concurrentResponses[0].body.data).toMatchObject({
      id: inviteId,
      state: "ACCEPTED",
      currentRevision: 1,
      response: {
        decision: "ACCEPT",
        respondedBy: recipient.userId,
        revision: 1,
      },
    });
    expect(concurrentResponses[1].body.data).toMatchObject({
      id: inviteId,
      state: "ACCEPTED",
      response: { respondedBy: recipient.userId, revision: 1 },
    });

    const responsePersistence = await sequelize.query<{
      response_count: string;
      command_count: string;
      revision_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM training.training_invites
           WHERE id = :inviteId AND state = 'ACCEPTED'
             AND responded_by_user_id = :recipientId AND responded_revision = 1) AS response_count,
         (SELECT count(*)::text FROM training.training_invite_commands
           WHERE invite_id = :inviteId AND actor_user_id = :recipientId) AS command_count,
         (SELECT count(*)::text FROM training.training_invite_revisions
           WHERE invite_id = :inviteId) AS revision_count`,
      {
        type: QueryTypes.SELECT,
        replacements: { inviteId, recipientId: recipient.userId },
      },
    );
    expect(responsePersistence[0]).toEqual({
      response_count: "1",
      command_count: "1",
      revision_count: "1",
    });

    const eventRows = await sequelize.query<{
      id: string;
      conversation_id: string;
      invitation_id: string;
      accepted_revision: number;
      starts_at: Date;
      time_zone: string;
      place_label: string;
      event_count: string;
      meeting_count: string;
      participant_count: string;
    }>(
      `SELECT e.id, e.conversation_id, e.invitation_id, e.accepted_revision,
              e.starts_at, e.time_zone, e.place_label,
              (SELECT count(*)::text FROM chat.conversation_events
                WHERE invitation_id = :inviteId) AS event_count,
              (SELECT count(*)::text FROM training.training_invite_meetings
                WHERE invite_id = :inviteId) AS meeting_count,
              (SELECT count(*)::text FROM chat.participants
                WHERE conversation_id = e.conversation_id) AS participant_count
         FROM chat.conversation_events e WHERE e.invitation_id = :inviteId`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(eventRows).toHaveLength(1);
    const eventRow = eventRows[0];
    expect(eventRow).toMatchObject({
      invitation_id: inviteId,
      accepted_revision: 1,
      starts_at: new Date("2030-05-01T22:30:00.000Z"),
      time_zone: "America/New_York",
      place_label: "Parque Central",
      event_count: "1",
      meeting_count: "1",
      participant_count: "2",
    });
    const expectedSystemEvent = {
      id: eventRow.id,
      conversationId: eventRow.conversation_id,
      senderId: null,
      type: "system",
      systemEvent: {
        kind: "TRAINING_INVITE_ACCEPTED",
        invitationId: inviteId,
        acceptedRevision: 1,
        startsAt: "2030-05-01T22:30:00.000Z",
        timeZone: "America/New_York",
        placeLabel: "Parque Central",
      },
      createdAt: expect.any(String),
    };
    const regularMessage = await request(httpServer)
      .post(url(`/me/conversations/${eventRow.conversation_id}/messages`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ body: "Nos vemos allí", clientRequestId: randomUUID() })
      .expect(201);
    const history = await request(httpServer)
      .get(url(`/me/conversations/${eventRow.conversation_id}/messages`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    expect(history.body.data).toContainEqual(expectedSystemEvent);
    expect(history.body.data).toContainEqual(regularMessage.body.data);
    expect(history.body.data.at(-1)).toEqual(regularMessage.body.data);
    const inviterHistory = await request(httpServer)
      .get(url(`/me/conversations/${eventRow.conversation_id}/messages`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    expect(inviterHistory.body.data).toContainEqual(expectedSystemEvent);
    expect(inviterHistory.body.data).toContainEqual(regularMessage.body.data);
    const newestPage = await request(httpServer)
      .get(
        url(`/me/conversations/${eventRow.conversation_id}/messages?limit=1`),
      )
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    expect(newestPage.body.data).toEqual([regularMessage.body.data]);
    const previousPage = await request(httpServer)
      .get(url(`/me/conversations/${eventRow.conversation_id}/messages`))
      .query({ before: regularMessage.body.data.createdAt })
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    expect(previousPage.body.data).toContainEqual(expectedSystemEvent);

    await expect(
      sequelize.query(
        `UPDATE training.training_invites SET responded_revision = 2
          WHERE id = :inviteId`,
        { replacements: { inviteId } },
      ),
    ).rejects.toThrow(/ck_training_invite_response_current_revision/i);
    await expect(
      sequelize.query(
        `UPDATE training.training_invites SET responded_revision = 2,
                current_revision = 2 WHERE id = :inviteId`,
        { replacements: { inviteId } },
      ),
    ).rejects.toThrow(/fk_training_invite_response_revision/i);

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ ...responsePayload, expectedRevision: 2 })
      .expect(409);

    await sequelize.query(
      "DELETE FROM training.training_invites WHERE id = :inviteId",
      { replacements: { inviteId } },
    );
    const cascadeCleanup = await sequelize.query<{
      invite_count: string;
      revision_count: string;
      command_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM training.training_invites WHERE id = :inviteId) AS invite_count,
         (SELECT count(*)::text FROM training.training_invite_revisions WHERE invite_id = :inviteId) AS revision_count,
         (SELECT count(*)::text FROM training.training_invite_commands WHERE invite_id = :inviteId) AS command_count`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(cascadeCleanup[0]).toEqual({
      invite_count: "0",
      revision_count: "0",
      command_count: "0",
    });
  }, 60000);

  it("H10.S1.M4 appends one idempotent counterproposal and rejects accepting a stale revision", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-m4-${label}-${suffix}@example.test`,
          password: "h10-m4-qa-password",
          nombreCompleto: `H10 M4 ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const stranger = await register("c");
    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    const created = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        clientRequestId: randomUUID(),
      })
      .expect(201);
    const inviteId = created.body.data.id as string;
    const counterPayload = {
      expectedRevision: 1,
      clientRequestId: randomUUID(),
      startsAt: "2030-05-02T18:30:00-04:00",
      timeZone: "America/New_York",
      durationMinutes: 75,
      place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
      mode: "OWN_ROUTINES",
      note: "Nos vemos mañana",
    };

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/counterpropose`))
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send(counterPayload)
      .expect(404);
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/counterpropose`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send(counterPayload)
      .expect(409);

    const concurrentCounters = await Promise.all([
      request(httpServer)
        .post(url(`/me/training-invitations/${inviteId}/counterpropose`))
        .set("Authorization", `Bearer ${recipient.accessToken}`)
        .send(counterPayload),
      request(httpServer)
        .post(url(`/me/training-invitations/${inviteId}/counterpropose`))
        .set("Authorization", `Bearer ${recipient.accessToken}`)
        .send(counterPayload),
    ]);
    expect(concurrentCounters.map(({ status }) => status)).toEqual([200, 200]);
    expect(concurrentCounters[0].body.data).toMatchObject({
      id: inviteId,
      state: "PENDING",
      currentRevision: 2,
      revisions: [
        {
          revision: 2,
          proposerId: recipient.userId,
          startsAt: "2030-05-02T22:30:00.000Z",
          durationMinutes: 75,
        },
      ],
    });

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/counterpropose`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ ...counterPayload, durationMinutes: 90 })
      .expect(409);
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        decision: "ACCEPT",
        expectedRevision: 1,
        clientRequestId: randomUUID(),
      })
      .expect(409);

    const accepted = await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        decision: "ACCEPT",
        expectedRevision: 2,
        clientRequestId: randomUUID(),
      })
      .expect(200);
    expect(accepted.body.data).toMatchObject({
      id: inviteId,
      state: "ACCEPTED",
      currentRevision: 2,
      response: {
        decision: "ACCEPT",
        respondedBy: inviter.userId,
        revision: 2,
      },
    });

    const stored = await sequelize.query<{
      revision_count: string;
      current_revision: number;
      command_count: string;
      response_actor: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM training.training_invite_revisions
           WHERE invite_id = :inviteId) AS revision_count,
         current_revision,
         (SELECT count(*)::text FROM training.training_invite_commands
           WHERE invite_id = :inviteId AND command_type = 'COUNTERPROPOSE') AS command_count,
         responded_by_user_id AS response_actor
       FROM training.training_invites WHERE id = :inviteId`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(stored[0]).toEqual({
      revision_count: "2",
      current_revision: 2,
      command_count: "1",
      response_actor: inviter.userId,
    });
  }, 60000);

  it("H10.S1.M5 expires a pending invite when its current start time has passed", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-m5-${label}-${suffix}@example.test`,
          password: "h10-m5-qa-password",
          nombreCompleto: `H10 M5 ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    const inviteId = randomUUID();
    const createRequestId = randomUUID();
    const acceptRequestId = randomUUID();
    await sequelize.query(
      `INSERT INTO training.training_invites
         (id, inviter_id, recipient_id, state, current_revision,
          client_request_id, request_fingerprint)
       VALUES (:inviteId, :inviterId, :recipientId, 'PENDING', 1,
               :createRequestId, repeat('a', 64))`,
      {
        replacements: {
          inviteId,
          inviterId: inviter.userId,
          recipientId: recipient.userId,
          createRequestId,
        },
      },
    );
    await sequelize.query(
      `INSERT INTO training.training_invite_revisions
         (invite_id, revision, proposer_id, starts_at, time_zone, duration_minutes,
          place_kind, place_id, place_label, mode)
       VALUES (:inviteId, 1, :proposerId, now() - interval '1 second',
               'America/La_Paz', 60, 'PUBLIC_PLACE', NULL, 'Parque Central',
               'OWN_ROUTINES')`,
      { replacements: { inviteId, proposerId: inviter.userId } },
    );

    const payload = {
      decision: "ACCEPT",
      expectedRevision: 1,
      clientRequestId: acceptRequestId,
    };
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send(payload)
      .expect(409);

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send(payload)
      .expect(409);

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ ...payload, clientRequestId: randomUUID() })
      .expect(409);

    const stored = await sequelize.query<{
      invite_state: string;
      response_fields_clear: boolean;
      expiration_commands: string;
      meeting_count: string;
      event_count: string;
    }>(
      `SELECT i.state AS invite_state,
              i.responded_by_user_id IS NULL AND i.responded_revision IS NULL
                AND i.responded_at IS NULL AS response_fields_clear,
              (SELECT count(*)::text FROM training.training_invite_commands c
                WHERE c.invite_id = i.id AND c.command_type = 'RESPOND'
                  AND c.result_state = 'EXPIRED') AS expiration_commands,
              (SELECT count(*)::text FROM training.training_invite_meetings m
                WHERE m.invite_id = i.id) AS meeting_count,
              (SELECT count(*)::text FROM chat.conversation_events e
                WHERE e.invitation_id = i.id) AS event_count
         FROM training.training_invites i WHERE i.id = :inviteId`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(stored[0]).toEqual({
      invite_state: "EXPIRED",
      response_fields_clear: true,
      expiration_commands: "1",
      meeting_count: "0",
      event_count: "0",
    });
  }, 60000);

  it("declines the current H10 revision once without creating a meeting or chat event", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-m7-${label}-${suffix}@example.test`,
          password: "h10-m7-qa-password",
          nombreCompleto: `H10 M7 ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    const created = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        clientRequestId: randomUUID(),
      })
      .expect(201);
    const inviteId = created.body.data.id as string;
    const payload = {
      decision: "DECLINE",
      expectedRevision: 1,
      clientRequestId: randomUUID(),
    };

    const declined = await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send(payload)
      .expect(200);
    expect(declined.body.data).toMatchObject({
      id: inviteId,
      state: "DECLINED",
      response: {
        decision: "DECLINE",
        respondedBy: recipient.userId,
        revision: 1,
      },
      meeting: null,
    });

    const replay = await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send(payload)
      .expect(200);
    expect(replay.body.data).toMatchObject({
      state: "DECLINED",
      response: { decision: "DECLINE" },
    });

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ ...payload, decision: "ACCEPT", clientRequestId: randomUUID() })
      .expect(409);

    const persisted = await sequelize.query<{
      state: string;
      decline_commands: string;
      meetings: string;
      chat_events: string;
    }>(
      `SELECT i.state,
              (SELECT count(*)::text FROM training.training_invite_commands c
                WHERE c.invite_id = i.id AND c.result_state = 'DECLINED') AS decline_commands,
              (SELECT count(*)::text FROM training.training_invite_meetings m
                WHERE m.invite_id = i.id) AS meetings,
              (SELECT count(*)::text FROM chat.conversation_events e
                WHERE e.invitation_id = i.id) AS chat_events
         FROM training.training_invites i WHERE i.id = :inviteId`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(persisted[0]).toEqual({
      state: "DECLINED",
      decline_commands: "1",
      meetings: "0",
      chat_events: "0",
    });
  }, 60000);

  it("H10.S1.M6 cancels future accepted meetings and revokes chat access on disconnect", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-m6-${label}-${suffix}@example.test`,
          password: "h10-m6-qa-password",
          nombreCompleto: `H10 M6 ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const outsider = await register("c");
    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    const created = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        clientRequestId: randomUUID(),
      })
      .expect(201);
    const inviteId = created.body.data.id as string;
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({
        decision: "ACCEPT",
        expectedRevision: 1,
        clientRequestId: randomUUID(),
      })
      .expect(200);

    const [event] = await sequelize.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM chat.conversation_events
        WHERE invitation_id = :inviteId`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(event?.conversation_id).toBeTruthy();

    const calendarUrl = url(
      `/me/training-invitations/${inviteId}/calendar.ics`,
    );
    const inviterCalendar = await request(httpServer)
      .get(calendarUrl)
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    expect(inviterCalendar.headers["content-type"]).toMatch(/^text\/calendar/);
    expect(inviterCalendar.headers["content-disposition"]).toContain(
      "attachment;",
    );
    expect(inviterCalendar.text).toContain("BEGIN:VCALENDAR\r\n");
    expect(inviterCalendar.text.replace(/\r\n /g, "")).toContain(
      `UID:gymsheet-${inviteId}-${inviter.userId}\r\n`,
    );
    expect(inviterCalendar.text).toContain("DTSTART:20300501T223000Z\r\n");
    expect(inviterCalendar.text).toContain("STATUS:CONFIRMED\r\n");

    const replayCalendar = await request(httpServer)
      .get(calendarUrl)
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    expect(replayCalendar.text).toBe(inviterCalendar.text);

    const recipientCalendar = await request(httpServer)
      .get(calendarUrl)
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    expect(recipientCalendar.text.replace(/\r\n /g, "")).toContain(
      `UID:gymsheet-${inviteId}-${recipient.userId}\r\n`,
    );
    await request(httpServer)
      .get(calendarUrl)
      .set("Authorization", `Bearer ${outsider.accessToken}`)
      .expect(404);

    const pending = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-02T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        clientRequestId: randomUUID(),
      })
      .expect(201);
    const pendingInviteId = pending.body.data.id as string;

    await request(httpServer)
      .delete(url(`/me/connections/${connection.id}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);

    for (const participant of [inviter, recipient]) {
      const agenda = await request(httpServer)
        .get(url("/me/training-invitations"))
        .set("Authorization", `Bearer ${participant.accessToken}`)
        .expect(200);
      expect(agenda.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: inviteId,
            state: "CANCELLED",
            response: expect.objectContaining({ decision: "ACCEPT" }),
            meeting: expect.objectContaining({
              cancelledAt: expect.any(String),
            }),
          }),
          expect.objectContaining({
            id: pendingInviteId,
            state: "CANCELLED",
            response: null,
            meeting: null,
          }),
        ]),
      );
      const cancelledCalendar = await request(httpServer)
        .get(calendarUrl)
        .set("Authorization", `Bearer ${participant.accessToken}`)
        .expect(200);
      expect(cancelledCalendar.text.replace(/\r\n /g, "")).toContain(
        `UID:gymsheet-${inviteId}-${participant.userId}\r\n`,
      );
      expect(cancelledCalendar.text).toContain("STATUS:CANCELLED\r\n");
      expect(cancelledCalendar.text).toContain("METHOD:CANCEL\r\n");
      expect(cancelledCalendar.text).toContain("SEQUENCE:2\r\n");
    }
    const outsiderAgenda = await request(httpServer)
      .get(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${outsider.accessToken}`)
      .expect(200);
    expect(outsiderAgenda.body.data).toEqual([]);

    for (const participant of [inviter, recipient]) {
      await request(httpServer)
        .get(url(`/me/conversations/${event.conversation_id}/messages`))
        .set("Authorization", `Bearer ${participant.accessToken}`)
        .expect(404);
      await request(httpServer)
        .post(url(`/me/conversations/${event.conversation_id}/messages`))
        .set("Authorization", `Bearer ${participant.accessToken}`)
        .send({ body: "¿Sigue en pie?", clientRequestId: randomUUID() })
        .expect(404);
    }

    const stored = await sequelize.query<{
      invite_state: string;
      response_actor: string;
      starts_at: Date;
      meeting_cancelled: boolean;
      revoked_at: Date | null;
      connection_count: string;
    }>(
      `SELECT i.state AS invite_state,
              i.responded_by_user_id AS response_actor,
              m.starts_at,
              m.cancelled_at IS NOT NULL AS meeting_cancelled,
              c.revoked_at,
              (SELECT count(*)::text FROM social.connections s
                WHERE s.id = :connectionId) AS connection_count
         FROM training.training_invites i
         JOIN training.training_invite_meetings m ON m.invite_id = i.id
         JOIN chat.conversation_events e ON e.invitation_id = i.id
         JOIN chat.conversations c ON c.id = e.conversation_id
        WHERE i.id = :inviteId`,
      {
        type: QueryTypes.SELECT,
        replacements: { inviteId, connectionId: connection.id },
      },
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      invite_state: "CANCELLED",
      response_actor: recipient.userId,
      starts_at: new Date("2030-05-01T22:30:00.000Z"),
      meeting_cancelled: true,
      connection_count: "0",
    });
    expect(stored[0].revoked_at).toBeTruthy();
  }, 60000);

  it("H10.S2.M2 shares the accepted routine snapshot without private workout data", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-shared-${label}-${suffix}@example.test`,
          password: "h10-invite-qa-password",
          nombreCompleto: `H10 Shared ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const stranger = await register("c");
    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    const temporaryExerciseId = randomUUID();
    temporaryExerciseIds.push(temporaryExerciseId);
    const [exercise] = await sequelize.query<{ id: string; name: string }>(
      `INSERT INTO public.ejercicios
         (id, nombre, grupo_muscular, tipo_ejercicio, estado)
       VALUES (:id, :name, 'Pecho', 'GLOBAL', 'ACTIVO')
       RETURNING id, nombre AS name`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          id: temporaryExerciseId,
          name: `H10 Shared QA ${suffix}`,
        },
      },
    );
    const routineId = randomUUID();
    const routineExerciseId = randomUUID();
    await sequelize.query(
      `INSERT INTO training.routines (id, nombre, created_by_user_id)
       VALUES (:routineId, 'Plan acordado', :ownerId)`,
      { replacements: { routineId, ownerId: inviter.userId } },
    );
    await sequelize.query(
      `INSERT INTO training.routine_exercises
         (id, routine_id, ejercicio_id, orden, series_objetivo, reps_min,
          reps_max, peso_objetivo_kg, descanso_seg, nota)
       VALUES (:id, :routineId, :exerciseId, 1, 3, 8, 12, 87.5, 90, 'nota privada de rutina')`,
      {
        replacements: {
          id: routineExerciseId,
          routineId,
          exerciseId: exercise.id,
        },
      },
    );

    const invitation = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        mode: "SHARED_SESSION",
        routineSessionId: routineId,
        clientRequestId: randomUUID(),
      })
      .expect(201);
    const inviteId = invitation.body.data.id as string;
    expect(invitation.body.data.revisions[0].mode).toBe("SHARED_SESSION");

    // A live edit after proposing must not rewrite the revision B is accepting.
    await sequelize.query(
      `UPDATE training.routine_exercises
          SET series_objetivo = 5, reps_min = 4, reps_max = 6,
              peso_objetivo_kg = 120, descanso_seg = 180, nota = 'changed private note'
        WHERE id = :id`,
      { replacements: { id: routineExerciseId } },
    );

    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({
        decision: "ACCEPT",
        expectedRevision: 1,
        clientRequestId: randomUUID(),
      })
      .expect(200);

    const persisted = await sequelize.query<{
      snapshot: { name: string; exercises: Array<Record<string, unknown>> };
      routine_snapshot: {
        name: string;
        exercises: Array<Record<string, unknown>>;
      };
    }>(
      `SELECT s.snapshot, r.routine_snapshot
         FROM training.training_invite_shared_snapshots s
         JOIN training.training_invite_revisions r
           ON r.invite_id = s.invite_id AND r.revision = s.accepted_revision
        WHERE s.invite_id = :inviteId`,
      { type: QueryTypes.SELECT, replacements: { inviteId } },
    );
    expect(persisted).toHaveLength(1);
    for (const snapshot of [
      persisted[0].snapshot,
      persisted[0].routine_snapshot,
    ]) {
      expect(snapshot).toEqual({
        name: "Plan acordado",
        exercises: [
          {
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            order: 1,
            targetSets: 3,
            repsMin: 8,
            repsMax: 12,
            restSeconds: 90,
          },
        ],
      });
      expect(JSON.stringify(snapshot)).not.toMatch(
        /peso|weight|nota|note|serie registrada|completed/i,
      );
    }

    await request(httpServer)
      .get(url(`/me/training-invitations/${inviteId}/shared-session`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          inviteId,
          routineId,
          revision: 1,
          name: "Plan acordado",
          exercises: [
            {
              exerciseId: exercise.id,
              exerciseName: exercise.name,
              targetSets: 3,
              repsMin: 8,
              repsMax: 12,
            },
          ],
        });
        expect(JSON.stringify(body.data)).not.toMatch(
          /peso|weight|nota|note|completed/i,
        );
      });
    await request(httpServer)
      .get(url(`/me/training-invitations/${inviteId}/shared-session`))
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .expect(404);
  }, 60000);

  it("H10.S2.M1/M3/M4/M5 keeps own routines, set weights and rewards per participant, including after meeting cancellation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `h10-own-routines-${label}-${suffix}@example.test`,
          password: "h10-own-routines-qa-password",
          nombreCompleto: `H10 Own Routines ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const userId = response.body.data.user.id as string;
      userIds.push(userId);
      return { userId, accessToken: response.body.data.accessToken as string };
    };

    const inviter = await register("a");
    const recipient = await register("b");
    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:inviterId, :recipientId, 'ACCEPTED', now()) RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviterId: inviter.userId,
          recipientId: recipient.userId,
        },
      },
    );
    connectionIds.push(connection.id);

    const invitation = await request(httpServer)
      .post(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({
        recipientId: recipient.userId,
        startsAt: "2030-05-01T18:30:00-04:00",
        timeZone: "America/New_York",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
        mode: "OWN_ROUTINES",
        clientRequestId: randomUUID(),
      })
      .expect(201);
    const inviteId = invitation.body.data.id as string;
    expect(invitation.body.data.revisions[0].mode).toBe("OWN_ROUTINES");
    await request(httpServer)
      .post(url(`/me/training-invitations/${inviteId}/respond`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({
        decision: "ACCEPT",
        expectedRevision: 1,
        clientRequestId: randomUUID(),
      })
      .expect(200);

    // Each participant owns a distinct private routine; the encounter doesn't
    // create or attach a shared workout record in OWN_ROUTINES mode.
    const exerciseId = randomUUID();
    temporaryExerciseIds.push(exerciseId);
    await sequelize.query(
      `INSERT INTO public.ejercicios (id, nombre, grupo_muscular, tipo_ejercicio, estado)
       VALUES (:id, :name, 'Pecho', 'GLOBAL', 'ACTIVO')`,
      { replacements: { id: exerciseId, name: `H10 Own Routine ${suffix}` } },
    );
    const createRoutine = async (ownerId: string, name: string) => {
      const routineId = randomUUID();
      const routineExerciseId = randomUUID();
      await sequelize.query(
        `INSERT INTO training.routines (id, nombre, created_by_user_id)
         VALUES (:routineId, :name, :ownerId)`,
        { replacements: { routineId, name, ownerId } },
      );
      await sequelize.query(
        `INSERT INTO training.routine_exercises
           (id, routine_id, ejercicio_id, orden, series_objetivo, reps_min, reps_max,
            peso_objetivo_kg, descanso_seg, nota)
         VALUES (:id, :routineId, :exerciseId, 1, 2, 6, 10, 60, 90, NULL)`,
        { replacements: { id: routineExerciseId, routineId, exerciseId } },
      );
      return routineId;
    };
    const [routineA, routineB] = await Promise.all([
      createRoutine(inviter.userId, `A own plan ${suffix}`),
      createRoutine(recipient.userId, `B own plan ${suffix}`),
    ]);

    const start = async (participant: typeof inviter, routineId: string) => {
      const response = await request(httpServer)
        .post(url(`/routines/${routineId}/start`))
        .set("Authorization", `Bearer ${participant.accessToken}`)
        .expect(201);
      expect(response.body.data).toMatchObject({
        rutinaId: routineId,
        usuarioId: participant.userId,
        estado: "EN_PROGRESO",
        ejercicios: [
          expect.objectContaining({
            rutinaEjercicioId: expect.any(String),
            series: [],
          }),
        ],
      });
      return response.body.data as {
        id: string;
        rutinaId: string;
        usuarioId: string;
        estado: string;
        ejercicios: Array<{ id: string }>;
      };
    };
    const sessionA = await start(inviter, routineA);
    const sessionB = await start(recipient, routineB);
    expect(sessionA.id).not.toBe(sessionB.id);
    expect(sessionA.rutinaId).not.toBe(sessionB.rutinaId);

    const recordSet = async (
      participant: typeof inviter,
      session: typeof sessionA,
      weight: number,
    ) =>
      request(httpServer)
        .post(
          url(`/workouts/session-exercises/${session.ejercicios[0].id}/sets`),
        )
        .set("Authorization", `Bearer ${participant.accessToken}`)
        .send({
          numeroSerie: 1,
          repeticiones: 8,
          pesoKg: weight,
          rir: 2,
          descansoSegAnterior: 90,
        })
        .expect(201);
    const setA = await recordSet(inviter, sessionA, 40);
    const setB = await recordSet(recipient, sessionB, 20);
    expect(setA.body.data.pesoKg).toBe(40);
    expect(setB.body.data.pesoKg).toBe(20);

    const persistedSets = await sequelize.query<{
      user_id: string;
      session_id: string;
      routine_id: string;
      weight: string;
    }>(
      `SELECT s.usuario_id AS user_id, s.id AS session_id, s.routine_id,
              ws.peso_kg::text AS weight
         FROM public.sesiones_entrenamiento s
         JOIN public.sesiones_ejercicios se ON se.sesion_id = s.id
         JOIN public.series_entrenamiento ws ON ws.sesion_ejercicio_id = se.id
        WHERE s.id IN (:sessionA, :sessionB)
        ORDER BY s.usuario_id`,
      {
        type: QueryTypes.SELECT,
        replacements: { sessionA: sessionA.id, sessionB: sessionB.id },
      },
    );
    expect(persistedSets).toHaveLength(2);
    expect(persistedSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: inviter.userId,
          session_id: sessionA.id,
          routine_id: routineA,
          weight: "40.00",
        }),
        expect.objectContaining({
          user_id: recipient.userId,
          session_id: sessionB.id,
          routine_id: routineB,
          weight: "20.00",
        }),
      ]),
    );

    const progressionUrl = url("/me/progression");
    const progressionBefore = await request(httpServer)
      .get(progressionUrl)
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    const recipientBefore = await request(httpServer)
      .get(progressionUrl)
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    expect(progressionBefore.body.data.stats.totalSessions).toBe(0);
    expect(recipientBefore.body.data.stats.totalSessions).toBe(0);

    const finishA = await request(httpServer)
      .patch(url(`/workouts/${sessionA.id}/finish`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .send({})
      .expect(200);
    expect(finishA.body.data.progression).toEqual(
      expect.objectContaining({ pointsEarned: expect.any(Number) }),
    );
    expect(finishA.body.data.progression.pointsEarned).toBeGreaterThan(0);

    const inviterAfterFinish = await request(httpServer)
      .get(progressionUrl)
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    const recipientAfterFinish = await request(httpServer)
      .get(progressionUrl)
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    expect(inviterAfterFinish.body.data.stats.totalSessions).toBe(1);
    expect(inviterAfterFinish.body.data.stats.totalSets).toBe(1);
    expect(inviterAfterFinish.body.data.stats.totalVolumeKg).toBe(320);
    expect(inviterAfterFinish.body.data.points).toBeGreaterThan(
      progressionBefore.body.data.points,
    );
    expect(recipientAfterFinish.body.data.stats.totalSessions).toBe(0);
    expect(recipientAfterFinish.body.data.stats.totalSets).toBe(0);
    expect(recipientAfterFinish.body.data.points).toBe(
      recipientBefore.body.data.points,
    );
    expect(sessionB.estado).toBe("EN_PROGRESO");

    await request(httpServer)
      .delete(url(`/me/connections/${connection.id}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);
    const cancelledAgenda = await request(httpServer)
      .get(url("/me/training-invitations"))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    expect(cancelledAgenda.body.data).toContainEqual(
      expect.objectContaining({
        id: inviteId,
        state: "CANCELLED",
        meeting: expect.objectContaining({ cancelledAt: expect.any(String) }),
      }),
    );

    const retainedCompletedSession = await request(httpServer)
      .get(url(`/workouts/${sessionA.id}`))
      .set("Authorization", `Bearer ${inviter.accessToken}`)
      .expect(200);
    expect(retainedCompletedSession.body.data).toMatchObject({
      id: sessionA.id,
      usuarioId: inviter.userId,
      rutinaId: routineA,
      estado: "FINALIZADA",
      ejercicios: [
        expect.objectContaining({
          series: [expect.objectContaining({ pesoKg: 40, repeticiones: 8 })],
        }),
      ],
    });
    await request(httpServer)
      .get(url(`/workouts/${sessionA.id}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(404);

    const persistedAfterCancellation = await sequelize.query<{
      session_id: string;
      user_id: string;
      status: string;
      set_count: string;
      reward_count: string;
    }>(
      `SELECT s.id AS session_id, s.usuario_id AS user_id, s.estado AS status,
              (SELECT count(*)::text FROM public.sesiones_ejercicios se
                JOIN public.series_entrenamiento ws ON ws.sesion_ejercicio_id = se.id
                WHERE se.sesion_id = s.id) AS set_count,
              (SELECT count(*)::text FROM progression.user_progress up
                WHERE up.usuario_id = s.usuario_id) AS reward_count
         FROM public.sesiones_entrenamiento s
        WHERE s.id = :sessionId`,
      { type: QueryTypes.SELECT, replacements: { sessionId: sessionA.id } },
    );
    expect(persistedAfterCancellation).toHaveLength(1);
    expect(persistedAfterCancellation[0]).toMatchObject({
      session_id: sessionA.id,
      user_id: inviter.userId,
      status: "FINALIZADA",
      set_count: "1",
      reward_count: "1",
    });
  }, 60000);
});
