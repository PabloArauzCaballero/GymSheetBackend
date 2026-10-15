import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../src/common/middleware/request-id.middleware";
import { env } from "../src/config/env";

describe("social discovery preferences API (PostgreSQL integration)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let token: string;
  let userId: string;
  let sequelize: Sequelize;
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    sequelize = moduleRef.get(Sequelize);
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const registered = await request(httpServer).post(url("/auth/register"))
      .send({ email: `social-preferences-${suffix}@example.test`, password: "qa-preferences-password", nombreCompleto: "QA Preferences", acceptedTerms: true })
      .expect(201);
    token = registered.body.data.accessToken as string;
    userId = registered.body.data.user.id as string;
  }, 60000);

  afterAll(async () => { await application?.close(); });

  it("requires explicit preferences and rejects stale writes between devices", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const initial = await request(httpServer).get(url("/me/discovery/preferences")).set(auth).expect(200);
    expect(initial.body.data).toEqual({ configured: false, version: 0 });

    const first = {
      genders: ["FEMALE"], intents: ["TRAINING"], minAge: 22, maxAge: 40,
      radiusKm: 20, flexibleAge: false, flexibleDistance: false, expectedVersion: 0,
    };
    const saved = await request(httpServer).put(url("/me/discovery/preferences")).set(auth).send(first).expect(200);
    expect(saved.body.data).toMatchObject({ configured: true, genders: ["FEMALE"], intents: ["TRAINING"], version: 1 });

    const update = { ...first, maxAge: 44, expectedVersion: 1 };
    const race = await Promise.all([
      request(httpServer).put(url("/me/discovery/preferences")).set(auth).send(update),
      request(httpServer).put(url("/me/discovery/preferences")).set(auth).send(update),
    ]);
    expect(race.map((response) => response.status).sort()).toEqual([200, 409]);

    const outboxJobs = await sequelize.query<{ queue_name: string; event_type: string; payload: Record<string, unknown> }>(
      `SELECT queue_name, event_type, payload FROM integration.outbox_jobs
        WHERE aggregate_id = :userId AND queue_name = 'recommendations.projection'
        ORDER BY created_at`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    expect(outboxJobs).toHaveLength(2);
    expect(outboxJobs.map((job) => job.event_type)).toEqual([
      "social.profile.deleted.v1", "social.profile.deleted.v1",
    ]);
    expect(outboxJobs[0].payload).toEqual(expect.objectContaining({ aggregateVersion: 1, profile: null }));
    expect(JSON.stringify(outboxJobs)).not.toMatch(/email|nombre|phone|weight|height|photo/i);

    await request(httpServer).put(url("/me/discovery/preferences")).set(auth)
      .send({ ...first, genders: ["FEMALE", "FEMALE"] }).expect(400);
    const persisted = await request(httpServer).get(url("/me/discovery/preferences")).set(auth).expect(200);
    expect(persisted.body.data.version).toBe(2);
    const deck = await request(httpServer).get(url("/me/discovery/deck?limit=10")).set(auth).expect(200);
    expect(deck.body.data.every((person: { gender: string; age: number }) =>
      person.gender === "FEMALE" && person.age >= 22 && person.age <= 44,
    )).toBe(true);

    const emptyDeck = await request(httpServer)
      .get(url("/me/discovery/deck?sucursalId=00000000-0000-4000-8000-000000000099&limit=10"))
      .set(auth)
      .expect(200);
    expect(emptyDeck.body.data).toEqual([]);
  });
});
