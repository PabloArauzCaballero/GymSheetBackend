import { ConflictException, NotFoundException } from "@nestjs/common";
import { SharedSessionService } from "./shared-session.service";

const inviteId = "e0000000-0000-4000-8000-000000000101";
const routineId = "e0000000-0000-4000-8000-000000000102";
const userId = "e0000000-0000-4000-8000-000000000103";
const snapshot = {
  name: "Rutina acordada",
  exercises: [
    {
      exerciseId: "e0000000-0000-4000-8000-000000000104",
      exerciseName: "Press de banca",
      order: 1,
      targetSets: 3,
      repsMin: 8,
      repsMax: 12,
      restSeconds: 90,
    },
  ],
};

describe("SharedSessionService H10.S2.M2", () => {
  it("persists an immutable sanitized snapshot for the accepted revision", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          invite_id: inviteId,
          source_routine_id: routineId,
          accepted_revision: 2,
          snapshot,
        },
      ]);
    const service = new SharedSessionService({ query } as never);

    await service.snapshotForAcceptedRevision(
      inviteId,
      routineId,
      2,
      snapshot,
      {} as never,
    );

    expect(query.mock.calls[0][0]).toContain(
      "ON CONFLICT (invite_id) DO NOTHING",
    );
    expect(query.mock.calls[0][1].replacements.snapshot).toEqual(
      JSON.stringify(snapshot),
    );
    expect(query.mock.calls[1][1]).toMatchObject({
      replacements: { inviteId },
    });
    expect(
      JSON.stringify(query.mock.calls[0][1].replacements.snapshot),
    ).not.toMatch(/weight|history|completed|note/i);
  });

  it("rejects an idempotent write that conflicts with the accepted revision", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          invite_id: inviteId,
          source_routine_id: routineId,
          accepted_revision: 1,
          snapshot,
        },
      ]);
    const service = new SharedSessionService({ query } as never);

    await expect(
      service.snapshotForAcceptedRevision(
        inviteId,
        routineId,
        2,
        snapshot,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("returns only the accepted participant snapshot", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ state: "ACCEPTED" }])
      .mockResolvedValueOnce([
        {
          invite_id: inviteId,
          source_routine_id: routineId,
          accepted_revision: 2,
          snapshot,
        },
      ]);
    const service = new SharedSessionService({ query } as never);

    await expect(service.getForParticipant(inviteId, userId)).resolves.toEqual({
      ...snapshot,
      inviteId,
      routineId,
      revision: 2,
    });
    expect(query.mock.calls[1][0]).toContain(
      "JOIN training.training_invite_meetings",
    );
    expect(query.mock.calls[1][1].replacements).toEqual({ inviteId, userId });
  });

  it("hides non-participant invitations and refuses pending snapshots", async () => {
    const missing = new SharedSessionService({
      query: jest.fn().mockResolvedValueOnce([]),
    } as never);
    await expect(
      missing.getForParticipant(inviteId, userId),
    ).rejects.toBeInstanceOf(NotFoundException);

    const pending = new SharedSessionService({
      query: jest.fn().mockResolvedValueOnce([{ state: "PENDING" }]),
    } as never);
    await expect(
      pending.getForParticipant(inviteId, userId),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
