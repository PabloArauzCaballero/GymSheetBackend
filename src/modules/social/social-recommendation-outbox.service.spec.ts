import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";
import { SocialRecommendationOutboxService } from "./social-recommendation-outbox.service";

describe("SocialRecommendationOutboxService", () => {
  function setup(snapshot: Record<string, unknown>) {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([snapshot])
      .mockResolvedValueOnce([{ version: 7 }]);
    const recordAndEnqueue = jest.fn().mockResolvedValue({ id: "event-id" });
    const service = new SocialRecommendationOutboxService(
      { query } as never,
      { recordAndEnqueue } as unknown as DomainEventPublisher,
    );
    return { service, query, recordAndEnqueue };
  }

  it("publishes only pseudonymous, allowlisted profile fields to the projection queue", async () => {
    const { service, recordAndEnqueue } = setup({
      id: "user-id",
      active: true,
      profile_enabled: true,
      age: 30,
      gender: "FEMALE",
      goal: "FUERZA",
      intents: ["TRAINING"],
      lat: -17.78,
      lon: -63.18,
      suspended: false,
    });
    await service.enqueueProfileSnapshot("user-id", {} as never);
    expect(recordAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: GymDomainEvent.SOCIAL_PROFILE_UPDATED,
        payload: expect.objectContaining({
          userId: "user-id",
          aggregateVersion: 7,
          profile: expect.objectContaining({
            id: "user-id",
            gender: "WOMAN",
            goals: ["FUERZA"],
            interests: ["intent:TRAINING", "goal:FUERZA"],
          }),
        }),
      }),
      [
        expect.objectContaining({
          queueName: "recommendations.projection",
          payload: expect.objectContaining({
            aggregateVersion: 7,
            profile: expect.objectContaining({ id: "user-id" }),
          }),
        }),
      ],
      {},
    );
    const serialized = JSON.stringify(recordAndEnqueue.mock.calls[0]);
    expect(serialized).not.toMatch(/nombre|email|phone|weight|height|photo/i);
  });

  it("emits a tombstone when the owner disabled discovery", async () => {
    const { service, recordAndEnqueue } = setup({
      id: "user-id",
      active: true,
      profile_enabled: false,
      age: 30,
      gender: "FEMALE",
      goal: null,
      intents: ["TRAINING"],
      lat: -17.78,
      lon: -63.18,
      suspended: false,
    });
    await service.enqueueProfileSnapshot("user-id", {} as never);
    expect(recordAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: GymDomainEvent.SOCIAL_PROFILE_DELETED,
        payload: { userId: "user-id", aggregateVersion: 7, schemaVersion: 1 },
      }),
      [
        expect.objectContaining({
          payload: { aggregateVersion: 7, schemaVersion: 1, profile: null },
        }),
      ],
      {},
    );
  });

  it("enqueues only pseudonymous verified signal data and transactionally retracts it", async () => {
    const recordAndEnqueue = jest.fn().mockResolvedValue({ id: "event-id" });
    const service = new SocialRecommendationOutboxService(
      { query: jest.fn() } as never,
      { recordAndEnqueue } as unknown as DomainEventPublisher,
    );
    const transaction = {} as never;
    await service.enqueueSignal(
      {
        viewerId: "viewer-id",
        profileId: "profile-id",
        impressionId: "impression-id",
        kind: "LIKE",
        featureCodes: ["goal:FUERZA", "goal:FUERZA"],
      },
      transaction,
    );
    const signalEvent = recordAndEnqueue.mock.calls[0][0];
    expect(signalEvent.eventName).toBe(
      GymDomainEvent.SOCIAL_RECOMMENDATION_SIGNAL_RECORDED,
    );
    expect(signalEvent.payload.signal).toMatchObject({
      viewerId: "viewer-id",
      profileId: "profile-id",
      impressionId: "impression-id",
      kind: "LIKE",
      observed: true,
      features: { interests: ["goal:FUERZA"] },
    });
    expect(recordAndEnqueue.mock.calls[0][1][0].queueName).toBe(
      "recommendations.projection",
    );
    await service.enqueueSignalRetraction(
      {
        viewerId: "viewer-id",
        profileId: "profile-id",
        impressionId: "impression-id",
      },
      transaction,
    );
    expect(recordAndEnqueue.mock.calls[1][0]).toMatchObject({
      eventName: GymDomainEvent.SOCIAL_RECOMMENDATION_SIGNAL_RETRACTED,
      payload: {
        schemaVersion: 1,
        retraction: {
          viewerId: "viewer-id",
          profileId: "profile-id",
          impressionId: "impression-id",
        },
      },
    });
    expect(
      recordAndEnqueue.mock.calls.every((call) => call[2] === transaction),
    ).toBe(true);
  });
});
