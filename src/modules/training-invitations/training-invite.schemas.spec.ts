import {
  counterproposeTrainingInviteSchema,
  createTrainingInviteSchema,
  respondTrainingInviteSchema,
} from "./training-invite.schemas";

const valid = {
  recipientId: "e0000000-0000-4000-8000-000000000002",
  startsAt: "2030-05-01T18:30:00-04:00",
  timeZone: "America/New_York",
  place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
  clientRequestId: "e0000000-0000-4000-8000-000000000003",
};

describe("createTrainingInviteSchema", () => {
  it("defaults a punctual invitation to 60 minutes and OWN_ROUTINES", () => {
    expect(createTrainingInviteSchema.parse(valid)).toMatchObject({
      durationMinutes: 60,
      mode: "OWN_ROUTINES",
    });
  });

  it("requires an explicit offset and a gym identifier", () => {
    expect(
      createTrainingInviteSchema.safeParse({
        ...valid,
        startsAt: "2030-05-01T18:30:00",
      }).success,
    ).toBe(false);
    expect(
      createTrainingInviteSchema.safeParse({
        ...valid,
        place: { kind: "GYM", label: "Sede" },
      }).success,
    ).toBe(false);
  });

  it("rejects impossible calendar dates and clock values instead of normalizing them", () => {
    for (const startsAt of [
      "2030-02-30T18:30:00-05:00",
      "2030-05-01T25:30:00-04:00",
      "2030-05-01T18:30:00-14:30",
    ]) {
      expect(
        createTrainingInviteSchema.safeParse({ ...valid, startsAt }).success,
      ).toBe(false);
    }
  });

  it("requires the RFC 3339 offset to match the selected IANA time zone", () => {
    expect(
      createTrainingInviteSchema.safeParse({
        ...valid,
        startsAt: "2030-05-01T18:30:00-05:00",
      }).success,
    ).toBe(false);
    expect(
      createTrainingInviteSchema.safeParse({
        ...valid,
        timeZone: "Not/AZone",
      }).success,
    ).toBe(false);
  });

  it("requires a routine reference when sharing a session", () => {
    expect(
      createTrainingInviteSchema.safeParse({ ...valid, mode: "SHARED_SESSION" })
        .success,
    ).toBe(false);
  });
});

describe("counterproposeTrainingInviteSchema H10.S1.M4", () => {
  it("requires a revision and a timezone-consistent schedule", () => {
    const proposal = counterproposeTrainingInviteSchema.parse({
      expectedRevision: 1,
      clientRequestId: "e0000000-0000-4000-8000-000000000005",
      startsAt: "2030-05-02T18:30:00-04:00",
      timeZone: "America/New_York",
      place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
    });
    expect(proposal).toMatchObject({
      expectedRevision: 1,
      durationMinutes: 60,
      mode: "OWN_ROUTINES",
    });
    expect(
      counterproposeTrainingInviteSchema.safeParse({
        expectedRevision: 1,
        clientRequestId: "e0000000-0000-4000-8000-000000000005",
        startsAt: "2030-05-02T18:30:00-04:00",
        timeZone: "Europe/Paris",
        place: { kind: "PUBLIC_PLACE", label: "Parque Central" },
      }).success,
    ).toBe(false);
  });
});

describe("respondTrainingInviteSchema invitation decline", () => {
  it.each(["ACCEPT", "DECLINE"] as const)("accepts %s", (decision) => {
    expect(
      respondTrainingInviteSchema.parse({
        decision,
        expectedRevision: 1,
        clientRequestId: "e0000000-0000-4000-8000-000000000006",
      }).decision,
    ).toBe(decision);
  });

  it("rejects unsupported decisions and additional fields", () => {
    expect(
      respondTrainingInviteSchema.safeParse({
        decision: "MAYBE",
        expectedRevision: 1,
        clientRequestId: "e0000000-0000-4000-8000-000000000006",
      }).success,
    ).toBe(false);
    expect(
      respondTrainingInviteSchema.safeParse({
        decision: "DECLINE",
        expectedRevision: 1,
        clientRequestId: "e0000000-0000-4000-8000-000000000006",
        reason: "extra",
      }).success,
    ).toBe(false);
  });
});
