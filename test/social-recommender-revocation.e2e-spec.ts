import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createServer } from "node:http";
import request from "supertest";
import { env } from "../src/config/env";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { SocialController } from "../src/modules/social/social.controller";
import { RecommendationsClient } from "../src/modules/social/recommendations-client";
import { DirectoryFilters, DirectoryRow, SocialRepository } from "../src/modules/social/social.repository";
import { SocialService } from "../src/modules/social/social.service";
import { UsersRepository } from "../src/modules/users/users.repository";
import { ChatEventsService } from "../src/modules/chat/chat-events.service";

const viewerId = "00000000-0000-4000-8000-000000000011";
const revokedId = "00000000-0000-4000-8000-000000000012";
const controlId = "00000000-0000-4000-8000-000000000013";

function candidate(userId: string): DirectoryRow {
  return {
    userId, fullName: `QA ${userId}`, objetivo: null, branchId: null, branchName: null,
    connectionStatus: "NONE", connectionId: null, socialStatus: null, photoUrl: null, photos: [],
    age: 30, gender: "FEMALE", experienceLevel: null, points: null, levelCode: null,
    recommendationArea: { lat: -17.78, lon: -63.18 }, recommendationIntents: ["TRAINING"],
  };
}

/** Real route/service/client; the directory fixture changes while local HTTP ranking is in flight. */
describe("H4.S4.M1 ranked candidate revocation race", () => {
  let app: INestApplication;
  let rankServer: ReturnType<typeof createServer>;
  let rankArrived: Promise<void>;
  let resolveRankArrived: () => void;
  let releaseRank: () => void;
  let releaseGate: Promise<void>;
  let providerCalls = 0;
  let directory: jest.Mock;
  const blocked = new Set<string>();

  beforeAll(async () => {
    rankArrived = new Promise<void>((resolve) => { resolveRankArrived = resolve; });
    releaseGate = new Promise<void>((resolve) => { releaseRank = resolve; });
    rankServer = createServer((incoming, response) => {
      providerCalls += 1;
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.on("end", () => {
        const rankRequest = JSON.parse(body) as { requestId: string; preferenceVersion: number };
        resolveRankArrived();
        void releaseGate.then(() => {
          if (!response.destroyed) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
            requestId: rankRequest.requestId,
            preferenceVersion: rankRequest.preferenceVersion,
            candidates: [{ profileId: revokedId, score: 0.9, reasonCodes: ["NEAR_SEARCH_AREA"] }],
            nextCursor: null,
          }));
        });
      });
    });
    await new Promise<void>((resolve) => rankServer.listen(0, "127.0.0.1", resolve));
    const address = rankServer.address();
    if (!address || typeof address === "string") throw new Error("Local ranking server failed to bind.");
    const client = new RecommendationsClient();
    const realRankPeople = client.rankPeople.bind(client);
    const transport = {
      rankPeople: (rankRequest: Parameters<RecommendationsClient["rankPeople"]>[0]) =>
        realRankPeople(rankRequest, { baseUrl: `http://127.0.0.1:${address.port}`, serviceToken: "local-race-test-token" }),
    };
    const rows = [candidate(revokedId), candidate(controlId)];
    directory = jest.fn(async (_viewerId: string, _tenantId: string, _defaultTenantId: string, filters: DirectoryFilters) =>
      rows.filter((row) => !blocked.has(row.userId) &&
        (!filters.userIds || filters.userIds.includes(row.userId)) &&
        (!filters.genders || filters.genders.includes(row.gender ?? "")) &&
        (!filters.minAge || (row.age ?? 0) >= filters.minAge) &&
        (!filters.maxAge || (row.age ?? 0) <= filters.maxAge)).slice(0, filters.limit));
    const repository = {
      discoveryPreferences: jest.fn().mockResolvedValue({ configured: true, genders: ["FEMALE"], intents: ["TRAINING"],
        minAge: 18, maxAge: 65, radiusKm: 100, flexibleAge: false, flexibleDistance: false, version: 1 }),
      discoverySettings: jest.fn().mockResolvedValue({ profileEnabled: true, crossGymEnabled: false, mapEnabled: false, version: 1 }),
      discoveryViewerContext: jest.fn().mockResolvedValue({ age: 30, gender: "MALE", area: { lat: -17.78, lon: -63.18 } }),
      directory,
    };
    const service = new SocialService(repository as unknown as SocialRepository, {} as UsersRepository,
      {} as ChatEventsService, transport as unknown as RecommendationsClient);
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController], providers: [{ provide: SocialService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(env.API_PREFIX);
    app.use((incoming: { user?: unknown }, _response: unknown, next: () => void) => {
      incoming.user = { id: viewerId, tenantId: "tenant", tenantScope: "tenant", role: "MEMBER",
        email: "viewer@example.test", impersonating: false };
      next();
    });
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    releaseRank?.();
    await app?.close();
    rankServer?.closeAllConnections();
    await new Promise<void>((resolve) => rankServer?.close(() => resolve()));
  });

  it("excludes a profile blocked after ranking begins but before the response returns", async () => {
    const deckPromise = request(app.getHttpServer()).get(`/${env.API_PREFIX}/me/discovery/deck?limit=10`).then((value) => value);
    let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([rankArrived, new Promise<never>((_resolve, reject) => {
        arrivalTimer = setTimeout(() => reject(new Error("The ranking request never reached the local server.")), 2_000);
      })]);
    } finally {
      clearTimeout(arrivalTimer);
    }
    blocked.add(revokedId);
    releaseRank();
    const response = await deckPromise;
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(providerCalls).toBe(1);
    expect(directory).toHaveBeenCalledTimes(2);
    expect(directory.mock.calls[1][3].userIds).toEqual([revokedId]);
  });
});
