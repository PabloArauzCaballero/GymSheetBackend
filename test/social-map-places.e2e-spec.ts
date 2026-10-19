import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../src/common/middleware/request-id.middleware";
import { env } from "../src/config/env";

describe("social map places API (PostgreSQL integration)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let accessToken: string;
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();
    const response = await request(httpServer).post(url("/auth/register")).send({
      email: `map-places-${Date.now()}@example.test`, password: "map-places-qa-password",
      nombreCompleto: "QA Map Places", acceptedTerms: true,
    }).expect(201);
    accessToken = response.body.data.accessToken as string;
  }, 60000);

  afterAll(async () => { await application?.close(); });

  it("searches an imported settlement through the authenticated city endpoint", async () => {
    const response = await request(httpServer).get(url("/me/social-map/cities?q=La%20Paz"))
      .set("Authorization", `Bearer ${accessToken}`).expect(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.stringMatching(/la paz/i), source: "OPENSTREETMAP" }),
    ]));
  });

  it("returns only attributed external gyms inside the requested map bounds", async () => {
    const response = await request(httpServer)
      .get(url("/me/social-map/gyms?south=-16.55&west=-68.17&north=-16.48&east=-68.10"))
      .set("Authorization", `Bearer ${accessToken}`).expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.length).toBeLessThanOrEqual(200);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      kind: "GYM", source: "OPENSTREETMAP", license: "ODbL-1.0", registered: false,
    }));
    expect(response.body.data[0].latitude).toBeGreaterThanOrEqual(-16.55);
    expect(response.body.data[0].longitude).toBeLessThanOrEqual(-68.10);
  });

  it("rejects an over-wide area before searching the external directory", async () => {
    await request(httpServer).get(url("/me/social-map/gyms?south=-16.8&west=-69&north=-16&east=-67"))
      .set("Authorization", `Bearer ${accessToken}`).expect(400);
  });
});
