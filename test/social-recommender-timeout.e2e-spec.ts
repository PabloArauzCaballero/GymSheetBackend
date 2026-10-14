import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import request from "supertest";
import { env } from "../src/config/env";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { SocialController } from "../src/modules/social/social.controller";
import { RecommendationsClient } from "../src/modules/social/recommendations-client";
import { DirectoryFilters, DirectoryRow, SocialRepository } from "../src/modules/social/social.repository";
import { SocialService } from "../src/modules/social/social.service";
import { UsersRepository } from "../src/modules/users/users.repository";
import { ChatEventsService } from "../src/modules/chat/chat-events.service";

const viewerId = "00000000-0000-4000-8000-000000000001";
const femaleId = "00000000-0000-4000-8000-000000000002";
const maleId = "00000000-0000-4000-8000-000000000003";
const minorId = "00000000-0000-4000-8000-000000000004";
const femaleSecondId = "00000000-0000-4000-8000-000000000005";
const olderFemaleId = "00000000-0000-4000-8000-000000000006";

function row(userId: string, gender: string, age: number): DirectoryRow {
  return {
    userId, fullName: `QA ${userId}`, objetivo: null, branchId: null, branchName: null,
    connectionStatus: "NONE", connectionId: null, socialStatus: null, photoUrl: null, photos: [],
    age, gender, experienceLevel: null, points: null, levelCode: null,
    recommendationArea: { lat: -17.78, lon: -63.18 }, recommendationIntents: ["TRAINING"],
  };
}

/** Real HTTP controller/service/client with an in-process directory fixture and a local slow provider. */
describe("H4.S4.M2/M4 slow recommendation HTTP fallback", () => {
  let app: INestApplication;
  let slowServer: ReturnType<typeof createServer>;
  let providerCalls = 0;
  let providerClosed = 0;
  let providerClosedPromise: Promise<void>;
  let resolveProviderClosed: () => void;
  let rankDurationMs = 0;
  let directory: jest.Mock;

  beforeAll(async () => {
    providerClosedPromise = new Promise<void>((resolve) => { resolveProviderClosed = resolve; });
    slowServer = createServer((_incoming, response) => {
      providerCalls += 1;
      response.on("close", () => { providerClosed += 1; resolveProviderClosed(); });
      const timer = setTimeout(() => {
        if (!response.destroyed) response.writeHead(200, { "content-type": "application/json" }).end("{}");
      }, 2_000);
      timer.unref();
    });
    await new Promise<void>((resolve) => slowServer.listen(0, "127.0.0.1", resolve));
    const address = slowServer.address();
    if (!address || typeof address === "string") throw new Error("Slow local HTTP provider failed to bind.");
    const realClient = new RecommendationsClient();
    const client = {
      rankPeople: async (rankRequest: Parameters<RecommendationsClient["rankPeople"]>[0]) => {
        const started = performance.now();
        const result = await realClient.rankPeople(rankRequest, {
          baseUrl: `http://127.0.0.1:${address.port}`, serviceToken: "local-timeout-test-token",
        });
        rankDurationMs = performance.now() - started;
        return result;
      },
    };
    const candidates = [row(femaleId, "FEMALE", 30), row(femaleSecondId, "FEMALE", 31),
      row(maleId, "MALE", 30), row(minorId, "FEMALE", 16), row(olderFemaleId, "FEMALE", 66)];
    directory = jest.fn(async (_viewerId: string, _tenantId: string, _defaultTenantId: string, filters: DirectoryFilters) =>
      candidates.filter((candidate) =>
        (!filters.userIds || filters.userIds.includes(candidate.userId)) &&
        (!filters.genders || filters.genders.includes(candidate.gender ?? "")) &&
        (!filters.gender || candidate.gender === filters.gender) &&
        (!filters.minAge || (candidate.age ?? 0) >= filters.minAge) &&
        (!filters.maxAge || (candidate.age ?? 0) <= filters.maxAge),
      ).slice(0, filters.limit));
    const repository = {
      discoveryPreferences: jest.fn().mockResolvedValue({ configured: true, genders: ["FEMALE"], intents: ["TRAINING"],
        minAge: 18, maxAge: 65, radiusKm: 100, flexibleAge: false, flexibleDistance: false, version: 1 }),
      discoverySettings: jest.fn().mockResolvedValue({ profileEnabled: true, crossGymEnabled: false, mapEnabled: false, version: 1 }),
      discoveryViewerContext: jest.fn().mockResolvedValue({ age: 30, gender: "MALE", area: { lat: -17.78, lon: -63.18 } }),
      directory,
    };
    const service = new SocialService(repository as unknown as SocialRepository, {} as UsersRepository,
      {} as ChatEventsService, client as unknown as RecommendationsClient);
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
    await app?.close();
    slowServer?.closeAllConnections();
    await new Promise<void>((resolve) => slowServer?.close(() => resolve()));
  });

  it("aborts the provider near 300 ms, makes one attempt, and serves only eligible cards", async () => {
    const response = await request(app.getHttpServer()).get(`/${env.API_PREFIX}/me/discovery/deck?limit=10`).expect(200);
    expect(response.body.data.map((entry: { userId: string }) => entry.userId)).toEqual([femaleId, femaleSecondId]);
    expect(response.body.data.every((entry: { age: number; gender: string }) => entry.age >= 18 && entry.gender === "FEMALE")).toBe(true);
    expect(providerCalls).toBe(1);
    await Promise.race([providerClosedPromise, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    expect(providerClosed).toBe(1);
    expect(rankDurationMs).toBeGreaterThanOrEqual(250);
    expect(rankDurationMs).toBeLessThan(700);
    expect(directory).toHaveBeenCalledTimes(2);
    expect(directory.mock.calls.every((call) => call[3].genders.join(",") === "FEMALE" &&
      call[3].minAge === 18 && call[3].maxAge === 65)).toBe(true);
  });
});
