import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  ConnectionStatus,
  NotificationChannel,
} from "../../common/enums/domain.enums";
import { UsersRepository } from "../users/users.repository";
import { ChatEventsService } from "../chat/chat-events.service";
import { SocialRepository } from "./social.repository";
import { SocialService } from "./social.service";

const userA = "00000000-0000-4000-8000-00000000000a";
const userB = "00000000-0000-4000-8000-00000000000b";
const userC = "00000000-0000-4000-8000-00000000000c";

function createService(
  repositoryOverrides: Partial<SocialRepository>,
  usersOverrides: Partial<UsersRepository> = {},
  notificationOverrides: { enqueueDirectMessage?: jest.Mock } = {},
  chatOverrides: { ensureDirectConversationInTransaction?: jest.Mock } = {},
): SocialService {
  return new SocialService(
    {
      canInteractAcrossTenants: jest.fn().mockResolvedValue(false),
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
      lockSocialPair: jest.fn(),
      runInTransaction: jest.fn(
        (work: (transaction: never) => Promise<unknown>) => work({} as never),
      ),
      issueDiscoveryImpressions: jest.fn().mockResolvedValue(undefined),
      getDiscoveryImpression: jest.fn().mockResolvedValue({ targetId: userB }),
      observeDiscoveryImpression: jest.fn().mockResolvedValue(true),
      consumeDiscoveryImpression: jest.fn().mockResolvedValue(["goal:FUERZA"]),
      enqueueRecommendationSignal: jest.fn().mockResolvedValue(undefined),
      retractLatestDiscoverySignal: jest.fn().mockResolvedValue(undefined),
      ...repositoryOverrides,
    } as unknown as SocialRepository,
    {
      findActiveById: jest.fn().mockResolvedValue({
        id: userB,
        fullName: "Otro Socio",
        tenantId: "default",
      }),
      findById: jest.fn().mockResolvedValue({ tenantId: null }),
      ...usersOverrides,
    } as unknown as UsersRepository,
    {
      emitConversationRevoked: jest.fn(),
    } as unknown as ChatEventsService,
    undefined,
    {
      enqueueDirectMessage: jest.fn().mockResolvedValue(true),
      ...notificationOverrides,
    } as never,
    {
      ensureDirectConversationInTransaction: jest.fn().mockResolvedValue("conversation-1"),
      ...chatOverrides,
    } as never,
  );
}

function fakeConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "conn-1",
    requesterId: userA,
    addresseeId: userB,
    status: ConnectionStatus.PENDING,
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    update: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  };
}

describe("SocialService.sendConnection", () => {
  it("rejects sending a connection to yourself", async () => {
    const service = createService({});
    await expect(
      service.sendConnection(userA, "default", userA),
    ).rejects.toThrow(BadRequestException);
  });

  it("does not reveal or connect a pair when either person blocked the other", async () => {
    const service = createService({
      isBlockedEitherWay: jest.fn().mockResolvedValue(true),
    });
    await expect(
      service.sendConnection(userA, "default", userB),
    ).rejects.toThrow(NotFoundException);
  });

  it("creates a pending request when none exists", async () => {
    const create = jest.fn().mockResolvedValue(fakeConnection());
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(null),
      create,
    });

    const result = await service.sendConnection(userA, "default", userB);

    // El tercer argumento es la transacción opcional: fuera de un swipe no hay.
    expect(create).toHaveBeenCalledWith(userA, userB, expect.any(Object));
    expect(result.status).toBe(ConnectionStatus.PENDING);
  });

  it("auto-accepts when the other person already sent a pending request", async () => {
    const existing = fakeConnection({ requesterId: userB, addresseeId: userA });
    const enqueueDirectMessage = jest.fn().mockResolvedValue(true);
    const service = createService(
      {
        findActiveBetween: jest.fn().mockResolvedValue(existing),
        respond: jest
          .fn()
          .mockImplementation(
            (connection: typeof existing, status: ConnectionStatus) => {
              connection.status = status;
              return Promise.resolve(connection);
            },
          ),
      },
      {},
      { enqueueDirectMessage },
    );

    const result = await service.sendConnection(userA, "default", userB);

    expect(result.status).toBe(ConnectionStatus.ACCEPTED);
    expect(enqueueDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: userB,
        channel: NotificationChannel.IN_APP,
        deduplicationKey: `connection.accepted:${existing.id}:${userB}`,
        metadata: { kind: "CONNECTION_ACCEPTED", connectionId: existing.id },
      }),
      expect.any(Object),
    );
  });

  it("rejects a second request while one is already pending in the same direction", async () => {
    const existing = fakeConnection({ requesterId: userA, addresseeId: userB });
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(existing),
    });

    await expect(
      service.sendConnection(userA, "default", userB),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects a request between accounts that are already connected", async () => {
    const existing = fakeConnection({ status: ConnectionStatus.ACCEPTED });
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(existing),
    });

    await expect(
      service.sendConnection(userA, "default", userB),
    ).rejects.toThrow(ConflictException);
  });

  it("reports a nonexistent addressee as not found", async () => {
    const service = createService(
      { findActiveBetween: jest.fn().mockResolvedValue(null) },
      { findActiveById: jest.fn().mockResolvedValue(null) },
    );
    await expect(
      service.sendConnection(userA, "default", userC),
    ).rejects.toThrow(NotFoundException);
  });

  it("keeps a different-tenant profile unavailable without bilateral discovery consent", async () => {
    const service = createService(
      { findActiveBetween: jest.fn().mockResolvedValue(null) },
      {
        findActiveById: jest.fn().mockResolvedValue({
          id: userB,
          fullName: "Otro Socio",
          tenantId: "other-gym",
        }),
      },
    );
    await expect(
      service.sendConnection(userA, "default", userB),
    ).rejects.toThrow(NotFoundException);
  });

  it("allows an adult cross-gym connection only after both profiles opt in", async () => {
    const create = jest.fn().mockResolvedValue(fakeConnection());
    const service = createService(
      {
        canInteractAcrossTenants: jest.fn().mockResolvedValue(true),
        findActiveBetween: jest.fn().mockResolvedValue(null),
        create,
      },
      {
        findActiveById: jest.fn().mockResolvedValue({
          id: userB,
          fullName: "Socio de otra sede",
          tenantId: "other-gym",
        }),
      },
    );

    const result = await service.sendConnection(userA, "default", userB);

    expect(result.status).toBe(ConnectionStatus.PENDING);
    expect(create).toHaveBeenCalledWith(userA, userB, expect.any(Object));
  });
});

describe("SocialService verified discovery signals", () => {
  const impressionId = "00000000-0000-4000-8000-0000000000a1";

  it("only acknowledges a server-issued impression owned by the current viewer", async () => {
    const observe = jest.fn().mockResolvedValue(true);
    const service = createService({
      getDiscoveryImpression: jest.fn().mockResolvedValue({ targetId: userB }),
      observeDiscoveryImpression: observe,
    });
    await expect(
      service.observeDiscoveryImpression(userA, "default", impressionId),
    ).resolves.toEqual({ observed: true });
    expect(observe).toHaveBeenCalledWith(
      userA,
      impressionId,
      expect.any(Object),
    );
  });

  it("enqueues learning in the swipe transaction after the issued impression was observed", async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      createPass: jest.fn().mockResolvedValue(undefined),
      enqueueRecommendationSignal: enqueue,
    });
    await expect(
      service.swipe(userA, "default", {
        targetId: userB,
        direction: "PASS",
        impressionId,
      }),
    ).resolves.toMatchObject({
      direction: "PASS",
      targetId: userB,
    });
    expect(enqueue).toHaveBeenCalledWith(
      {
        viewerId: userA,
        profileId: userB,
        impressionId,
        kind: "PASS",
        featureCodes: ["goal:FUERZA"],
      },
      expect.any(Object),
    );
  });

  it("rejects reused, unobserved, expired, or mismatched impressions without saving a swipe", async () => {
    const createPass = jest.fn();
    const service = createService({
      consumeDiscoveryImpression: jest.fn().mockResolvedValue(null),
      createPass,
    });
    await expect(
      service.swipe(userA, "default", {
        targetId: userB,
        direction: "PASS",
        impressionId,
      }),
    ).rejects.toThrow(ConflictException);
    expect(createPass).not.toHaveBeenCalled();
  });
});

describe("SocialService.blockUser", () => {
  it("revokes active conversations and emits invalidations after persisting the block", async () => {
    const events = { emitConversationRevoked: jest.fn() };
    const repository = {
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
      blockUser: jest.fn().mockResolvedValue(["conversation-1"]),
    };
    const service = new SocialService(
      repository as unknown as SocialRepository,
      {
        findActiveById: jest.fn().mockResolvedValue({ id: userB }),
      } as unknown as UsersRepository,
      events as unknown as ChatEventsService,
    );

    await expect(service.blockUser(userA, userB)).resolves.toEqual({
      blocked: true,
    });
    expect(repository.blockUser).toHaveBeenCalledWith(userA, userB);
    expect(events.emitConversationRevoked).toHaveBeenCalledWith(
      "conversation-1",
      userA,
    );
  });
});

describe("SocialService.respondConnection", () => {
  it("creates the pair chat atomically when the addressee accepts", async () => {
    const connection = fakeConnection({ addresseeId: userB, requesterId: userA });
    const ensureDirectConversationInTransaction = jest.fn().mockResolvedValue("conversation-1");
    const service = createService(
      {
        findByIdForUser: jest.fn().mockResolvedValue(connection),
        respond: jest.fn().mockImplementation((conn: typeof connection, status: ConnectionStatus) => {
          conn.status = status;
          return Promise.resolve(conn);
        }),
        namesFor: jest.fn().mockResolvedValue(new Map([[userA, "Quien Pidió"]])),
      },
      {},
      {},
      { ensureDirectConversationInTransaction },
    );

    await service.respondConnection("conn-1", userB, { action: "ACCEPT" });

    expect(ensureDirectConversationInTransaction).toHaveBeenCalledWith(
      userA,
      userB,
      expect.any(Object),
    );
  });

  it("lets only the addressee accept a pending request", async () => {
    const connection = fakeConnection({
      addresseeId: userB,
      requesterId: userA,
    });
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue(connection),
      respond: jest
        .fn()
        .mockImplementation(
          (conn: typeof connection, status: ConnectionStatus) => {
            conn.status = status;
            return Promise.resolve(conn);
          },
        ),
      namesFor: jest.fn().mockResolvedValue(new Map([[userA, "Quien Pidió"]])),
    });

    const result = await service.respondConnection("conn-1", userB, {
      action: "ACCEPT",
    });
    expect(result.status).toBe(ConnectionStatus.ACCEPTED);
  });

  it("does not let the requester respond to their own request", async () => {
    const connection = fakeConnection({
      addresseeId: userB,
      requesterId: userA,
    });
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue(connection),
    });

    await expect(
      service.respondConnection("conn-1", userA, { action: "ACCEPT" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects responding to a request that was already answered", async () => {
    const connection = fakeConnection({
      addresseeId: userB,
      requesterId: userA,
      status: ConnectionStatus.ACCEPTED,
    });
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue(connection),
    });

    await expect(
      service.respondConnection("conn-1", userB, { action: "ACCEPT" }),
    ).rejects.toThrow(ConflictException);
  });

  it("rechecks both cross-gym permissions when the recipient accepts", async () => {
    const connection = fakeConnection({
      requesterId: userA,
      addresseeId: userB,
    });
    const respond = jest.fn();
    const service = createService(
      {
        canInteractAcrossTenants: jest.fn().mockResolvedValue(false),
        findByIdForUser: jest.fn().mockResolvedValue(connection),
        respond,
      },
      {
        findActiveById: jest.fn().mockImplementation((id: string) =>
          Promise.resolve({
            id,
            tenantId: id === userA ? "gym-a" : "gym-b",
          }),
        ),
      },
    );

    await expect(
      service.respondConnection("conn-1", userB, { action: "ACCEPT" }),
    ).rejects.toThrow(NotFoundException);
    expect(respond).not.toHaveBeenCalled();
  });
});

describe("SocialService.withdrawConnection", () => {
  it("does not allow the recipient to withdraw a pending request", async () => {
    const revokeConnection = jest.fn().mockResolvedValue(null);
    const service = createService({ revokeConnection });

    await expect(service.withdrawConnection("conn-1", userB)).rejects.toThrow(
      NotFoundException,
    );
    expect(revokeConnection).toHaveBeenCalledWith("conn-1", userB);
  });

  it("revokes active chats and emits an invalidation event after disconnecting", async () => {
    const emitConversationRevoked = jest.fn();
    const service = new SocialService(
      {
        revokeConnection: jest
          .fn()
          .mockResolvedValue({ conversationIds: ["conv-1"] }),
      } as unknown as SocialRepository,
      {} as UsersRepository,
      { emitConversationRevoked } as unknown as ChatEventsService,
    );

    await expect(service.withdrawConnection("conn-1", userA)).resolves.toEqual({
      deleted: true,
    });
    expect(emitConversationRevoked).toHaveBeenCalledWith("conv-1", userA);
  });
});

describe("SocialService.viewSocialStatus", () => {
  it("hides the status from a non-connection", async () => {
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(null),
    });
    await expect(service.viewSocialStatus(userA, userB)).resolves.toBeNull();
  });

  it("hides the status when the owner marked it not visible", async () => {
    const service = createService({
      findActiveBetween: jest
        .fn()
        .mockResolvedValue(
          fakeConnection({ status: ConnectionStatus.ACCEPTED }),
        ),
      getSettings: jest
        .fn()
        .mockResolvedValue({ visible: false, socialStatus: "SINGLE" }),
    });
    await expect(service.viewSocialStatus(userA, userB)).resolves.toBeNull();
  });

  it("shows the status to an accepted connection when marked visible", async () => {
    const service = createService({
      findActiveBetween: jest
        .fn()
        .mockResolvedValue(
          fakeConnection({ status: ConnectionStatus.ACCEPTED }),
        ),
      getSettings: jest
        .fn()
        .mockResolvedValue({ visible: true, socialStatus: "SINGLE" }),
    });
    await expect(service.viewSocialStatus(userA, userB)).resolves.toBe(
      "SINGLE",
    );
  });
});

describe("SocialService.updateDiscoverySettings", () => {
  it("stores separate profile, cross-gym and map consent with optimistic versioning", async () => {
    const current = {
      profileEnabled: false,
      crossGymEnabled: false,
      mapEnabled: false,
      version: 0,
    };
    const updateDiscoverySettings = jest.fn().mockResolvedValue({
      profileEnabled: true,
      crossGymEnabled: true,
      mapEnabled: false,
      version: 1,
    });
    const service = createService({
      discoverySettings: jest.fn().mockResolvedValue(current),
      updateDiscoverySettings,
    });

    await expect(
      service.updateDiscoverySettings(userA, {
        profileEnabled: true,
        crossGymEnabled: true,
        mapEnabled: false,
        expectedVersion: 0,
      }),
    ).resolves.toEqual({
      profileEnabled: true,
      crossGymEnabled: true,
      mapEnabled: false,
      version: 1,
    });
    expect(updateDiscoverySettings).toHaveBeenCalledWith(
      userA,
      {
        profileEnabled: true,
        crossGymEnabled: true,
        mapEnabled: false,
        version: 1,
      },
      0,
    );
  });

  it("does not allow map or cross-gym exposure while the profile is paused", async () => {
    const service = createService({
      discoverySettings: jest.fn().mockResolvedValue({
        profileEnabled: false,
        crossGymEnabled: false,
        mapEnabled: false,
        version: 0,
      }),
    });

    await expect(
      service.updateDiscoverySettings(userA, {
        profileEnabled: false,
        crossGymEnabled: false,
        mapEnabled: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("SocialService.updateDiscoveryPreferences", () => {
  const input = {
    genders: ["FEMALE"] as ("MALE" | "FEMALE")[],
    intents: ["TRAINING"] as ("TRAINING" | "FRIENDSHIP" | "DATING")[],
    minAge: 18,
    maxAge: 65,
    radiusKm: 25,
    flexibleAge: false,
    flexibleDistance: false,
    expectedVersion: 0,
  };

  it("persists only the explicitly selected preferences", async () => {
    const saved = { ...input, configured: true as const, version: 1 };
    const updateDiscoveryPreferences = jest.fn().mockResolvedValue(saved);
    const service = createService({ updateDiscoveryPreferences });
    await expect(
      service.updateDiscoveryPreferences(userA, input),
    ).resolves.toEqual(saved);
    expect(updateDiscoveryPreferences).toHaveBeenCalledWith(userA, input);
  });

  it("rejects an optimistic version conflict instead of overwriting another device", async () => {
    const service = createService({
      updateDiscoveryPreferences: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.updateDiscoveryPreferences(userA, input),
    ).rejects.toThrow(ConflictException);
  });
});

describe("SocialService.discoveryDeck preferences", () => {
  it("H4.S4.M3 rejects a cursor from an earlier filter context before querying candidates", async () => {
    const directory = jest.fn().mockResolvedValue([]);
    const service = createService({
      discoveryPreferences: jest.fn().mockResolvedValue({
        configured: true,
        genders: ["MALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 3,
      }),
      discoverySettings: jest.fn().mockResolvedValue({
        profileEnabled: true,
        crossGymEnabled: true,
        mapEnabled: false,
        version: 1,
      }),
      directory,
    });
    await expect(
      service.discoveryDeck(userA, "tenant", {
        limit: 10,
        cursor: "old-cursor",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(directory).not.toHaveBeenCalled();
  });

  it("H4.S4.M3 invalidates an issued cursor after changing the saved gender", async () => {
    const female = {
      userId: userB,
      fullName: "Female",
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: "FUERZA",
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: ["TRAINING"],
    };
    const another = { ...female, userId: userC };
    const preferences = jest
      .fn()
      .mockResolvedValueOnce({
        configured: true,
        genders: ["FEMALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 1,
      })
      .mockResolvedValueOnce({
        configured: true,
        genders: ["FEMALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 1,
      })
      .mockResolvedValueOnce({
        configured: true,
        genders: ["FEMALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 1,
      })
      .mockResolvedValue({
        configured: true,
        genders: ["MALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 2,
      });
    const directory = jest.fn().mockResolvedValue([female, another]);
    const rankPeople = jest.fn().mockResolvedValue({
      candidates: [{ profileId: userB, score: 1, reasonCodes: [] }],
      nextCursor: "signed-ranker-cursor",
    });
    const service = new SocialService(
      {
        discoveryPreferences: preferences,
        discoverySettings: jest.fn().mockResolvedValue({
          profileEnabled: true,
          crossGymEnabled: true,
          mapEnabled: false,
          version: 1,
        }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory,
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople,
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    const first = await service.discoveryDeckPage(userA, "tenant", {
      limit: 1,
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(
      service.discoveryDeckPage(userA, "tenant", {
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(directory).toHaveBeenCalledTimes(2);
    expect(rankPeople).toHaveBeenCalledTimes(1);
    expect(rankPeople.mock.calls[0][0].candidates[0].interests).toEqual([
      "intent:TRAINING",
      "goal:FUERZA",
    ]);
  });
  it("H4.S4.M3 rechecks preferences on the short local path", async () => {
    const female = {
      userId: userB,
      gender: "FEMALE",
      photos: [],
      fullName: "Female",
    };
    const male = { ...female, userId: userC, gender: "MALE", fullName: "Male" };
    const preferences = jest
      .fn()
      .mockResolvedValueOnce({
        configured: true,
        genders: ["FEMALE"],
        intents: ["TRAINING"],
        minAge: 18,
        maxAge: 50,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 1,
      })
      .mockResolvedValue({
        configured: true,
        genders: ["MALE"],
        intents: ["TRAINING"],
        minAge: 18,
        maxAge: 50,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 2,
      });
    const directory = jest
      .fn()
      .mockResolvedValueOnce([female])
      .mockResolvedValueOnce([male]);
    const service = createService({
      discoveryPreferences: preferences,
      discoverySettings: jest
        .fn()
        .mockResolvedValue({ profileEnabled: true, crossGymEnabled: false }),
      directory,
    });
    await expect(
      service.discoveryDeckPage(userA, "tenant", { limit: 10 }),
    ).resolves.toMatchObject({ items: [{ userId: userC }] });
    expect(directory).toHaveBeenCalledTimes(2);
    expect(directory.mock.calls[1][3]).toEqual(
      expect.objectContaining({ genders: ["MALE"] }),
    );
  });

  it("H4.S4.M3 advances past a blocked ranked page before ending pagination", async () => {
    const row = (userId: string) => ({
      userId,
      fullName: userId,
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    });
    const directory = jest
      .fn()
      .mockResolvedValueOnce([row(userB), row(userC)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(userC)]);
    const rankPeople = jest
      .fn()
      .mockResolvedValueOnce({
        candidates: [{ profileId: userB, score: 1, reasonCodes: [] }],
        nextCursor: "rank-next",
      })
      .mockResolvedValueOnce({
        candidates: [{ profileId: userC, score: 1, reasonCodes: [] }],
        nextCursor: null,
      });
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["TRAINING"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: jest
          .fn()
          .mockResolvedValue({ profileEnabled: true, crossGymEnabled: true }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory,
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople,
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    await expect(
      service.discoveryDeckPage(userA, "tenant", { limit: 1 }),
    ).resolves.toMatchObject({ items: [{ userId: userC }] });
    expect(rankPeople).toHaveBeenCalledTimes(2);
    expect(rankPeople.mock.calls[1][0].cursor).toBe("rank-next");
  });

  it("H4.S4.M3 serves no more cards than the requested limit", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      userId: `candidate-${index}`,
      fullName: `Candidate ${index}`,
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    }));
    const rankPeople = jest.fn().mockResolvedValue({
      candidates: rows.map((row) => ({
        profileId: row.userId,
        score: 1,
        reasonCodes: [],
      })),
      nextCursor: null,
    });
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["TRAINING"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: jest
          .fn()
          .mockResolvedValue({ profileEnabled: true, crossGymEnabled: true }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory: jest.fn().mockResolvedValue(rows),
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople,
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    const page = await service.discoveryDeckPage(userA, "tenant", {
      limit: 10,
    });
    expect(page.items).toHaveLength(10);
  });

  it("H4.S4.M3 carries overflow ranked IDs across pages without loss or duplication", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      userId: `candidate-${index}`,
      fullName: `Candidate ${index}`,
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    }));
    const rankPeople = jest.fn().mockResolvedValue({
      candidates: rows.map((row) => ({
        profileId: row.userId,
        score: 1,
        reasonCodes: [],
      })),
      nextCursor: null,
    });
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["TRAINING"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: jest
          .fn()
          .mockResolvedValue({ profileEnabled: true, crossGymEnabled: true }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory: jest
          .fn()
          .mockImplementation(
            (
              _viewer: string,
              _tenant: string,
              _defaultTenant: string,
              filters: { userIds?: string[] },
            ) =>
              Promise.resolve(
                filters.userIds
                  ? rows.filter((row) => filters.userIds?.includes(row.userId))
                  : rows,
              ),
          ),
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople,
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    const received: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 15; page += 1) {
      const result = await service.discoveryDeckPage(userA, "tenant", {
        limit: 10,
        ...(cursor ? { cursor } : {}),
      });
      received.push(...result.items.map((item) => item.userId));
      cursor = result.nextCursor;
      if (page < 14) expect(cursor).toEqual(expect.any(String));
    }
    expect(received).toEqual(rows.map((row) => row.userId));
    expect(new Set(received).size).toBe(150);
    expect(cursor).toBeNull();
    expect(rankPeople).toHaveBeenCalledTimes(1);
  });

  it("H4.S4.M3 emits a continuation for 140 UUIDs plus a full motor cursor", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      userId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      fullName: `Candidate ${index}`,
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    }));
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["TRAINING"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: jest
          .fn()
          .mockResolvedValue({ profileEnabled: true, crossGymEnabled: true }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory: jest
          .fn()
          .mockImplementation(
            (
              _viewer: string,
              _tenant: string,
              _defaultTenant: string,
              filters: { userIds?: string[] },
            ) =>
              Promise.resolve(
                filters.userIds
                  ? rows.filter((row) => filters.userIds?.includes(row.userId))
                  : rows,
              ),
          ),
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople: jest.fn().mockResolvedValue({
          candidates: rows.map((row) => ({
            profileId: row.userId,
            score: 1,
            reasonCodes: [],
          })),
          nextCursor: "x".repeat(8_000),
        }),
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    const page = await service.discoveryDeckPage(userA, "tenant", {
      limit: 10,
    });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.nextCursor!.length).toBeLessThanOrEqual(12_000);
  });

  it("H4.S4.M3 returns a controlled upstream error when a continuation cannot fit", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      userId: `${index.toString().padStart(3, "0")}${"x".repeat(197)}`,
      fullName: `Candidate ${index}`,
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    }));
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["TRAINING"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: jest
          .fn()
          .mockResolvedValue({ profileEnabled: true, crossGymEnabled: true }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory: jest.fn().mockResolvedValue(rows),
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople: jest.fn().mockResolvedValue({
          candidates: rows.map((row) => ({
            profileId: row.userId,
            score: 1,
            reasonCodes: [],
          })),
          nextCursor: "x".repeat(8_000),
        }),
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    await expect(
      service.discoveryDeckPage(userA, "tenant", { limit: 10 }),
    ).rejects.toThrow(BadGatewayException);
  });

  it("H4.S4.M3 rechecks revoked consent after the final ranked directory read", async () => {
    const row = (userId: string) => ({
      userId,
      fullName: userId,
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    });
    const directory = jest
      .fn()
      .mockResolvedValueOnce([row(userB), row(userC)])
      .mockResolvedValueOnce([row(userB)])
      .mockResolvedValue([]);
    const settings = jest
      .fn()
      .mockResolvedValueOnce({ profileEnabled: true, crossGymEnabled: true })
      .mockResolvedValueOnce({ profileEnabled: true, crossGymEnabled: true })
      .mockResolvedValue({ profileEnabled: true, crossGymEnabled: false });
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["TRAINING"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: settings,
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory,
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople: jest.fn().mockResolvedValue({
          candidates: [{ profileId: userB, score: 1, reasonCodes: [] }],
          nextCursor: null,
        }),
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    await expect(
      service.discoveryDeckPage(userA, "tenant", { limit: 1 }),
    ).resolves.toMatchObject({ items: [] });
    expect(directory).toHaveBeenCalledTimes(3);
    expect(directory.mock.calls[2][3]).toEqual(
      expect.objectContaining({ includeCrossGym: false }),
    );
  });
  it("requires saved preferences and never guesses a gender or age range", async () => {
    const service = createService({
      discoveryPreferences: jest
        .fn()
        .mockResolvedValue({ configured: false, version: 0 }),
      directory: jest.fn(),
    });
    await expect(
      service.discoveryDeck(userA, "tenant", { limit: 10 }),
    ).rejects.toThrow(BadRequestException);
    expect(service["repository"].directory).not.toHaveBeenCalled();
  });

  it("applies the exact saved gender and age limits before returning cards", async () => {
    const directory = jest.fn().mockResolvedValue([]);
    const service = createService({
      discoveryPreferences: jest.fn().mockResolvedValue({
        configured: true,
        genders: ["FEMALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 2,
      }),
      discoverySettings: jest.fn().mockResolvedValue({
        profileEnabled: true,
        crossGymEnabled: true,
        mapEnabled: false,
        version: 1,
      }),
      directory,
    });
    await expect(
      service.discoveryDeck(userA, "tenant", { limit: 10 }),
    ).resolves.toEqual([]);
    expect(directory).toHaveBeenCalledWith(
      userA,
      "tenant",
      expect.any(String),
      expect.objectContaining({ genders: ["FEMALE"], minAge: 24, maxAge: 38 }),
    );
  });

  it("revalidates every ranked ID against fresh block and consent state", async () => {
    const eligible = {
      userId: userB,
      fullName: "QA Visible",
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
    };
    const newlyBlocked = { ...eligible, userId: userC, fullName: "QA Blocked" };
    const directory = jest
      .fn()
      .mockResolvedValueOnce([eligible, newlyBlocked])
      .mockResolvedValueOnce([eligible]);
    const recommendations = {
      rankPeople: jest.fn().mockResolvedValue({
        requestId: "request",
        preferenceVersion: 2,
        candidates: [
          { profileId: userC, score: 0.9, reasonCodes: [] },
          { profileId: userB, score: 0.7, reasonCodes: [] },
        ],
      }),
    };
    const repository = {
      discoveryPreferences: jest.fn().mockResolvedValue({
        configured: true,
        genders: ["FEMALE"],
        intents: ["TRAINING"],
        minAge: 24,
        maxAge: 38,
        radiusKm: 25,
        flexibleAge: false,
        flexibleDistance: false,
        version: 2,
      }),
      discoverySettings: jest.fn().mockResolvedValue({
        profileEnabled: true,
        crossGymEnabled: true,
        mapEnabled: false,
        version: 1,
      }),
      discoveryViewerContext: jest.fn().mockResolvedValue({
        age: 30,
        gender: "MALE",
        area: { lat: -17.78, lon: -63.18 },
      }),
      directory,
    };
    const service = new SocialService(
      repository as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      recommendations as unknown as import("./recommendations-client").RecommendationsClient,
    );
    await expect(
      service.discoveryDeck(userA, "tenant", { limit: 10 }),
    ).resolves.toMatchObject([{ userId: userB }]);
    expect(directory).toHaveBeenCalledTimes(2);
    expect(directory.mock.calls[1][3]).toEqual(
      expect.objectContaining({
        userIds: [userC, userB],
        genders: ["FEMALE"],
        minAge: 24,
        maxAge: 38,
      }),
    );
  });

  it("falls back to a fresh locally authorized deck when the ranker times out", async () => {
    const eligible = {
      userId: userB,
      fullName: "QA Visible",
      photos: [],
      age: 30,
      gender: "FEMALE",
      connectionStatus: "NONE" as const,
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      objetivo: null,
      branchId: null,
      branchName: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
      recommendationArea: { lat: -17.78, lon: -63.18 },
      recommendationIntents: [],
    };
    const other = { ...eligible, userId: userC, fullName: "QA Other" };
    const directory = jest.fn().mockResolvedValue([eligible, other]);
    const preferences = {
      configured: true as const,
      genders: ["FEMALE"] as ("MALE" | "FEMALE")[],
      intents: ["TRAINING"] as ("TRAINING" | "FRIENDSHIP" | "DATING")[],
      minAge: 24,
      maxAge: 38,
      radiusKm: 25,
      flexibleAge: false,
      flexibleDistance: false,
      version: 2,
    };
    const repository = {
      discoveryPreferences: jest.fn().mockResolvedValue(preferences),
      discoverySettings: jest.fn().mockResolvedValue({
        profileEnabled: true,
        crossGymEnabled: true,
        mapEnabled: false,
        version: 1,
      }),
      discoveryViewerContext: jest.fn().mockResolvedValue({
        age: 30,
        gender: "MALE",
        area: { lat: -17.78, lon: -63.18 },
      }),
      directory,
    };
    const service = new SocialService(
      repository as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      {
        rankPeople: jest.fn().mockResolvedValue(null),
      } as unknown as import("./recommendations-client").RecommendationsClient,
    );
    await expect(
      service.discoveryDeck(userA, "tenant", { limit: 10 }),
    ).resolves.toMatchObject([{ userId: userB }, { userId: userC }]);
    expect(directory).toHaveBeenCalledTimes(2);
    expect(directory.mock.calls[1][3]).toEqual(
      expect.objectContaining({
        genders: ["FEMALE"],
        minAge: 24,
        maxAge: 38,
        excludeDecided: true,
      }),
    );
  });
});
