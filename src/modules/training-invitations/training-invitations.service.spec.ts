import { ForbiddenException } from "@nestjs/common";
import { TrainingInvitationsService } from "./training-invitations.service";
import { createTrainingInviteSchema } from "./training-invite.schemas";

const inviterId = "e0000000-0000-4000-8000-000000000001";
const recipientId = "e0000000-0000-4000-8000-000000000002";
const clientRequestId = "e0000000-0000-4000-8000-000000000003";
const tenantId = "gym-tenant";

function input() {
  return createTrainingInviteSchema.parse({
    recipientId,
    startsAt: "2030-05-01T18:30:00-04:00",
    timeZone: "America/New_York",
    durationMinutes: 60,
    place: {
      kind: "GYM",
      placeId: "e0000000-0000-4000-8000-000000000004",
      label: "Cliente forged label",
    },
    clientRequestId,
  });
}

function setup(queryResults: unknown[][]) {
  const transaction = { LOCK: { UPDATE: "UPDATE" } };
  const query = jest.fn();
  queryResults.forEach((result) => query.mockResolvedValueOnce(result));
  const sequelize = {
    query,
    transaction: jest.fn((run: (tx: typeof transaction) => unknown) =>
      run(transaction),
    ),
  };
  return {
    service: new TrainingInvitationsService(sequelize as never, {} as never, {} as never),
    query,
    sequelize,
  };
}

describe("TrainingInvitationsService H10.S1.M1/M2", () => {
  it("rejects a non-connection without inserting an invitation or revision", async () => {
    const { service, query } = setup([
      [],
      [{ id: inviterId }, { id: recipientId }],
      [],
    ]);

    await expect(
      service.create(inviterId, tenantId, input()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(3);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO training.training_invites"),
      ),
    ).toBe(false);
  });

  it("creates one pending revision after confirming the active gym and normalizes time to UTC", async () => {
    const invite = {
      id: "e0000000-0000-4000-8000-000000000010",
      inviter_id: inviterId,
      recipient_id: recipientId,
      state: "PENDING",
      current_revision: 1,
      created_at: new Date("2026-10-11T12:00:00.000Z"),
      updated_at: new Date("2026-10-11T12:00:00.000Z"),
    };
    const revision = {
      invite_id: invite.id,
      revision: 1,
      proposer_id: inviterId,
      starts_at: new Date("2030-05-01T22:30:00.000Z"),
      time_zone: "America/New_York",
      duration_minutes: 60,
      place_kind: "GYM",
      place_id: "e0000000-0000-4000-8000-000000000004",
      place_label: "Gym canonical",
      mode: "OWN_ROUTINES",
      routine_session_id: null,
      note: null,
      created_at: new Date("2026-10-11T12:00:00.000Z"),
    };
    const { service, query } = setup([
      [],
      [{ id: inviterId }, { id: recipientId }],
      [{ id: "connection-1" }],
      [],
      [{ id: "e0000000-0000-4000-8000-000000000004", name: "Gym canonical" }],
      [invite],
      [revision],
    ]);

    const result = await service.create(inviterId, tenantId, input());

    expect(result).toMatchObject({
      id: invite.id,
      state: "PENDING",
      currentRevision: 1,
      participants: [inviterId, recipientId],
      revisions: [
        {
          startsAt: "2030-05-01T22:30:00.000Z",
          timeZone: "America/New_York",
          place: {
            kind: "GYM",
            placeId: revision.place_id,
            label: "Gym canonical",
          },
          mode: "OWN_ROUTINES",
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls[5][0]).toContain(
      "INSERT INTO training.training_invites",
    );
    expect(query.mock.calls[4][0]).toContain("tenant_id = :tenantId");
    expect(query.mock.calls[4][1].replacements).toMatchObject({ tenantId });
    expect(query.mock.calls[6][0]).toContain(
      "INSERT INTO training.training_invite_revisions",
    );
  });

  it("rejects invalid time zones before opening a transaction", async () => {
    const { service, sequelize } = setup([]);
    await expect(
      service.create(inviterId, tenantId, {
        ...input(),
        timeZone: "Not/AZone",
      }),
    ).rejects.toThrow("IANA");
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});

describe("TrainingInvitationsService invitation agenda", () => {
  it("lists cancelled meetings for a participant with response and cancellation timestamps", async () => {
    const query = jest.fn().mockResolvedValue([{
      id: "invite-1",
      inviter_id: inviterId,
      recipient_id: recipientId,
      state: "CANCELLED",
      current_revision: 2,
      created_at: new Date("2026-10-11T12:00:00.000Z"),
      updated_at: new Date("2026-10-12T12:00:00.000Z"),
      responded_by_user_id: recipientId,
      responded_revision: 2,
      responded_at: new Date("2026-10-11T13:00:00.000Z"),
      revision_proposer_id: inviterId,
      revision_starts_at: new Date("2030-05-01T22:30:00.000Z"),
      revision_time_zone: "America/New_York",
      revision_duration_minutes: 60,
      revision_place_kind: "PUBLIC_PLACE",
      revision_place_id: null,
      revision_place_label: "Parque Central",
      revision_mode: "OWN_ROUTINES",
      revision_routine_session_id: null,
      revision_note: null,
      revision_created_at: new Date("2026-10-11T12:30:00.000Z"),
      meeting_id: "meeting-1",
      meeting_accepted_revision: 2,
      meeting_starts_at: new Date("2030-05-01T22:30:00.000Z"),
      meeting_time_zone: "America/New_York",
      meeting_place_label: "Parque Central",
      meeting_cancelled_at: new Date("2026-10-12T12:00:00.000Z"),
    }]);
    const service = new TrainingInvitationsService({ query } as never, {} as never, {} as never);

    const result = await service.listForUser(recipientId);

    expect(query.mock.calls[0]?.[0]).toContain("WHERE i.inviter_id = :userId OR i.recipient_id = :userId");
    expect(query.mock.calls[0]?.[1].replacements).toEqual({ userId: recipientId });
    expect(result).toEqual([expect.objectContaining({
      id: "invite-1",
      state: "CANCELLED",
      currentRevision: 2,
      participants: [inviterId, recipientId],
      response: {
        decision: "ACCEPT",
        respondedBy: recipientId,
        revision: 2,
        respondedAt: "2026-10-11T13:00:00.000Z",
      },
      meeting: {
        id: "meeting-1",
        acceptedRevision: 2,
        startsAt: "2030-05-01T22:30:00.000Z",
        timeZone: "America/New_York",
        placeLabel: "Parque Central",
        cancelledAt: "2026-10-12T12:00:00.000Z",
      },
    })]);
  });
});
