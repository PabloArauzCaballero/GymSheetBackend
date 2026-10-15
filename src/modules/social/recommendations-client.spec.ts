import {
  PeopleRankRequest,
  RecommendationsClient,
} from "./recommendations-client";

const request: PeopleRankRequest = {
  version: 1,
  requestId: "request-1",
  preferenceVersion: 3,
  limit: 10,
  candidates: [
    {
      id: "candidate-1",
      active: true,
      complete: true,
      suspended: false,
      age: 30,
      gender: "MALE",
      intents: ["TRAINING"],
      interests: [],
      goals: [],
      availability: [],
      area: { lat: -17.78, lon: -63.18 },
    },
  ],
  seenIds: [],
  viewer: {
    id: "viewer-1",
    age: 30,
    gender: "FEMALE",
    intents: ["TRAINING"],
    interests: [],
    goals: [],
    availability: [],
    area: { lat: -17.78, lon: -63.18 },
    preferences: {
      genders: ["MAN"],
      minAge: 25,
      maxAge: 40,
      radiusKm: 25,
      flexibleAge: false,
      flexibleDistance: false,
    },
  },
};

describe("RecommendationsClient", () => {
  it("uses the internal token and a 300ms request budget", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requestId: "request-1",
        preferenceVersion: 3,
        candidates: [
          {
            profileId: "candidate-1",
            score: 0.7,
            reasonCodes: ["NEAR_SEARCH_AREA"],
          },
        ],
      }),
    });
    const client = new RecommendationsClient();
    await expect(
      client.rankPeople(
        request,
        {
          baseUrl: "http://recommendations:8080/",
          serviceToken: "service-token",
        },
        fetcher,
      ),
    ).resolves.toMatchObject({ candidates: [{ profileId: "candidate-1" }] });
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://recommendations:8080/v1/rank/people",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { authorization: "Bearer service-token" },
      method: "POST",
    });
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("forwards the signed cursor and current filter context and returns the next cursor", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requestId: "request-1",
        preferenceVersion: 3,
        candidates: [],
        nextCursor: "signed-next-cursor",
      }),
    });
    const client = new RecommendationsClient();
    const result = await client.rankPeople(
      {
        ...request,
        cursor: "signed-current-cursor",
        filterContext: {
          objetivo: "TRAINING",
          sucursalId: "branch-1",
          genero: "MALE",
          q: "running",
          tenantId: "gym-1",
        },
      },
      { baseUrl: "http://recommendations", serviceToken: "service-token" },
      fetcher,
    );

    expect(fetcher.mock.calls[0][1].body).toContain(
      '"cursor":"signed-current-cursor"',
    );
    expect(fetcher.mock.calls[0][1].body).toContain('"branchId":"branch-1"');
    expect(result).toMatchObject({ nextCursor: "signed-next-cursor" });
  });

  it("turns a rejected continuation into HTTP 422 instead of returning stale ranked cards", async () => {
    const client = new RecommendationsClient();
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "invalid_cursor" }),
    });

    await expect(
      client.rankPeople(
        { ...request, cursor: "expired-or-filter-mismatched" },
        {
          baseUrl: "http://recommendations",
          serviceToken: "service-token",
        },
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("falls back when disabled, unavailable, or returned versions do not match", async () => {
    const fetcher = jest.fn();
    await expect(
      new RecommendationsClient().rankPeople(
        request,
        { baseUrl: "", serviceToken: "" },
        fetcher,
      ),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    const stale = new RecommendationsClient();
    await expect(
      stale.rankPeople(
        request,
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            requestId: "request-1",
            preferenceVersion: 2,
            candidates: [],
          }),
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      new RecommendationsClient().rankPeople(
        request,
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        jest.fn().mockRejectedValue(new Error("timeout")),
      ),
    ).resolves.toBeNull();
  });

  it("acknowledges projection events only when the engine confirms the complete batch", async () => {
    const client = new RecommendationsClient();
    const event = {
      eventId: "event-id",
      aggregateId: "profile-id",
      aggregateVersion: 1,
      schemaVersion: 1 as const,
      type: "social.profile.deleted" as const,
      payload: {},
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ status: "APPLIED" }] }),
    });
    await expect(
      client.consumeEvents(
        [event],
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        fetcher,
      ),
    ).resolves.toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("http://recommendations/v1/events");
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await expect(
      client.consumeEvents(
        [event],
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        jest
          .fn()
          .mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }),
      ),
    ).resolves.toBe(false);
  });

  it("delivers verified signals and retries projection-order ignores", async () => {
    const client = new RecommendationsClient();
    const signal = {
      eventId: "signal-1",
      viewerId: "viewer-1",
      profileId: "candidate-1",
      impressionId: "impression-1",
      kind: "LIKE" as const,
      occurredAt: new Date().toISOString(),
      observed: true as const,
      features: { interests: ["goal:FUERZA"] },
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ status: "APPLIED" }] }),
    });
    await expect(
      client.consumeSignals(
        [signal],
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        fetcher,
      ),
    ).resolves.toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("http://recommendations/v1/signals");
    expect(fetcher.mock.calls[0][1].body).toContain('"observed":true');
    await expect(
      client.consumeSignals(
        [signal],
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ results: [{ status: "IGNORED" }] }),
        }),
      ),
    ).resolves.toBe(false);
  });

  it("delivers signal retractions through the internal endpoint", async () => {
    const client = new RecommendationsClient();
    const retraction = {
      eventId: "retract-1",
      viewerId: "viewer-1",
      profileId: "candidate-1",
      impressionId: "impression-1",
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ status: "APPLIED" }] }),
    });
    await expect(
      client.consumeSignalRetractions(
        [retraction],
        { baseUrl: "http://recommendations", serviceToken: "service-token" },
        fetcher,
      ),
    ).resolves.toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://recommendations/v1/signals/retract",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { authorization: "Bearer service-token" },
      method: "POST",
    });
  });
});
