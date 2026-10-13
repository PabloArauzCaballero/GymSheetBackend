import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { json, urlencoded } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../src/common/middleware/request-id.middleware";
import { TrainingGoal } from "../src/common/enums/domain.enums";
import { env } from "../src/config/env";

const enabled = Boolean(env.RECOMMENDATIONS_URL && env.RECOMMENDATIONS_SERVICE_TOKEN);

(enabled ? describe : describe.skip)("recommendation engine integration (PostgreSQL + HTTP)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
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
  }, 60000);

  afterAll(async () => { await application?.close(); });

  it("uses the internal ranker and still serves only currently authorized profiles", async () => {
    let phase = "register accounts";
    try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const accounts = await Promise.all(["viewer", "match", "control"].map(async (label) => {
      const response = await request(httpServer).post(url("/auth/register")).send({
        email: `recommendation-${label}-${suffix}@example.test`, password: "qa-recommendation-password",
        nombreCompleto: `QA ${label} ${suffix}`, acceptedTerms: true,
      }).expect(201);
      return { token: response.body.data.accessToken as string, userId: response.body.data.user.id as string };
    }));
    const [viewer, match, control] = accounts;
    phase = "load branch";
    const branches = await sequelize.query<{ id: string }>(
      `SELECT id FROM facilities.branches WHERE tenant_id = :tenantId AND status = 'ACTIVE'
        AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY name LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { tenantId: env.DEFAULT_TENANT_ID } },
    );
    if (!branches[0]) throw new Error("The QA database needs one active, geocoded branch in its default tenant.");

    phase = "setup accounts";
    const setupPerson = async (account: typeof viewer, gender: "MALE" | "FEMALE", goal: TrainingGoal) => {
      const auth = { Authorization: `Bearer ${account.token}` };
      phase = `update account ${account.userId}`;
      await request(httpServer).patch(url("/users/me")).set(auth).send({ genero: gender, sedeId: branches[0].id }).expect(200);
      phase = `create profile ${account.userId}`;
      await request(httpServer).post(url("/profile")).set(auth).send({
        fechaNacimiento: "1996-01-15", pesoKg: 75, estaturaCm: 180, objetivo: goal,
      }).expect(201);
      phase = `enable discovery ${account.userId}`;
      await request(httpServer).patch(url("/me/social-discovery-settings")).set(auth).send({
        profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0,
      }).expect(200);
    };
    await setupPerson(viewer, "MALE", TrainingGoal.STRENGTH);
    await setupPerson(match, "FEMALE", TrainingGoal.STRENGTH);
    await setupPerson(control, "FEMALE", TrainingGoal.HYPERTROPHY);
    phase = "save viewer preferences";
    await request(httpServer).put(url("/me/discovery/preferences")).set({ Authorization: `Bearer ${viewer.token}` }).send({
      genders: ["FEMALE"], intents: ["TRAINING"], minAge: 18, maxAge: 65,
      radiusKm: 100, flexibleAge: false, flexibleDistance: false, expectedVersion: 0,
    }).expect(200);

    phase = "fetch deck";
    const deck = await request(httpServer).get(url("/me/discovery/deck?limit=10"))
      .set({ Authorization: `Bearer ${viewer.token}` }).expect(200);
    const rankedIds = deck.body.data.map((entry: { userId: string }) => entry.userId);
    expect(rankedIds).toContain(match.userId);
    expect(rankedIds).toContain(control.userId);
    expect(rankedIds.indexOf(match.userId)).toBeLessThan(rankedIds.indexOf(control.userId));
    expect(deck.body.data.every((entry: { age: number; gender: string }) => entry.age >= 18 && entry.gender === "FEMALE")).toBe(true);

    phase = "page public discovery cursor";
    const auth = { Authorization: `Bearer ${viewer.token}` };
    const firstPage = await request(httpServer).get(url("/me/discovery/deck?limit=1")).set(auth).expect(200);
    expect(firstPage.body.data).toHaveLength(1);
    const cursor = firstPage.headers["x-next-cursor"] as string | undefined;
    expect(cursor).toEqual(expect.any(String));
    const secondPage = await request(httpServer)
      .get(url(`/me/discovery/deck?limit=1&cursor=${encodeURIComponent(cursor!)}`)).set(auth).expect(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].userId).not.toBe(firstPage.body.data[0].userId);

    phase = "invalidate cursor after preferences update";
    await request(httpServer).put(url("/me/discovery/preferences")).set(auth).send({
      genders: ["MALE"], intents: ["TRAINING"], minAge: 18, maxAge: 65,
      radiusKm: 100, flexibleAge: false, flexibleDistance: false, expectedVersion: 1,
    }).expect(200);
    await request(httpServer)
      .get(url(`/me/discovery/deck?limit=1&cursor=${encodeURIComponent(cursor!)}`)).set(auth).expect(400);
    } catch (error) {
      throw new Error(`Integration failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }, 60000);


});
