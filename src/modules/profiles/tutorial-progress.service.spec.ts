import type { Sequelize } from "sequelize-typescript";
import { tutorialIdSchema, tutorialProgressUpsertSchema } from "./tutorial-progress.schemas";
import { TutorialProgressService } from "./tutorial-progress.service";

const row = {
  tutorial_id: "platform-intro",
  status: "SKIPPED",
  version: "1.0.0",
  current_step_id: "welcome",
  started_at: new Date("2026-11-12T10:00:00.000Z"),
  completed_at: null,
  last_interaction_at: new Date("2026-11-12T10:05:00.000Z"),
  repeat_count: 0,
};

function createService(query: jest.Mock) {
  return new TutorialProgressService({ query } as unknown as Sequelize);
}

describe("TutorialProgressService", () => {
  it("lists only the caller's rows and maps them to the shared record shape", async () => {
    const query = jest.fn().mockResolvedValue([row]);
    const records = await createService(query).list("user-a");
    expect(query.mock.calls[0][1].replacements).toEqual({ userId: "user-a" });
    expect(records).toEqual([
      {
        tutorialId: "platform-intro",
        status: "SKIPPED",
        version: "1.0.0",
        currentStepId: "welcome",
        startedAt: "2026-11-12T10:00:00.000Z",
        completedAt: null,
        lastInteractionAt: "2026-11-12T10:05:00.000Z",
        repeatCount: 0,
      },
    ]);
  });

  it("upserts keyed by the token's user and keeps the fields the body leaves out", async () => {
    const query = jest.fn().mockResolvedValue([row]);
    await createService(query).upsert("user-a", "platform-intro", { status: "SKIPPED", version: "1.0.0" });
    const { replacements } = query.mock.calls[0][1];
    expect(replacements).toMatchObject({
      userId: "user-a",
      tutorialId: "platform-intro",
      hasCurrentStep: false,
      hasCompletedAt: false,
      hasRepeatCount: false,
    });
  });

  it("reset deletes one guide and returns what is left", async () => {
    const query = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    await expect(createService(query).reset("user-a", "platform-intro")).resolves.toEqual([]);
    expect(query.mock.calls[0][1].replacements).toEqual({ userId: "user-a", tutorialId: "platform-intro" });
  });

  it("rejects unknown statuses and ids with spaces or slashes", () => {
    expect(tutorialProgressUpsertSchema.safeParse({ status: "DONE", version: "1" }).success).toBe(false);
    expect(tutorialIdSchema.safeParse("bad id").success).toBe(false);
    expect(tutorialIdSchema.safeParse("../x").success).toBe(false);
    expect(tutorialIdSchema.safeParse("senda:intro").success).toBe(true);
  });
});
