import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../src/common/middleware/request-id.middleware";
import { env } from "../src/config/env";

describe("social blocks API (PostgreSQL integration)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let firstToken: string;
  let secondToken: string;
  let firstId: string;
  let secondId: string;
  let thirdToken: string;
  let thirdId: string;
  let fourthToken: string;
  let fourthId: string;
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

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [first, second, third, fourth] = await Promise.all([
      request(httpServer).post(url("/auth/register")).send({ email: `block-a-${suffix}@example.test`, password: "block-qa-password", nombreCompleto: "QA Block A", acceptedTerms: true }).expect(201),
      request(httpServer).post(url("/auth/register")).send({ email: `block-b-${suffix}@example.test`, password: "block-qa-password", nombreCompleto: "QA Block B", acceptedTerms: true }).expect(201),
      request(httpServer).post(url("/auth/register")).send({ email: `block-c-${suffix}@example.test`, password: "block-qa-password", nombreCompleto: "QA Block C", acceptedTerms: true }).expect(201),
      request(httpServer).post(url("/auth/register")).send({ email: `block-d-${suffix}@example.test`, password: "block-qa-password", nombreCompleto: "QA Block D", acceptedTerms: true }).expect(201),
    ]);
    firstToken = first.body.data.accessToken as string;
    secondToken = second.body.data.accessToken as string;
    firstId = first.body.data.user.id as string;
    secondId = second.body.data.user.id as string;
    thirdToken = third.body.data.accessToken as string;
    fourthToken = fourth.body.data.accessToken as string;
    thirdId = third.body.data.user.id as string;
    fourthId = fourth.body.data.user.id as string;
  }, 60000);

  afterAll(async () => { await application?.close(); });

  it("blocks both directions and allows the owner to restore visibility by unblocking", async () => {
    await request(httpServer).post(url("/me/blocks")).set("Authorization", `Bearer ${firstToken}`)
      .send({ targetUserId: secondId }).expect(201);

    const blocked = await request(httpServer).get(url("/me/blocks"))
      .set("Authorization", `Bearer ${firstToken}`).expect(200);
    expect(blocked.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: secondId, displayName: "QA Block B" }),
    ]));

    await request(httpServer).post(url("/me/connections")).set("Authorization", `Bearer ${secondToken}`)
      .send({ addresseeId: firstId }).expect(404);
    await request(httpServer).get(url(`/me/gym-directory/${secondId}`))
      .set("Authorization", `Bearer ${firstToken}`).expect(404);

    await request(httpServer).delete(url(`/me/blocks/${secondId}`))
      .set("Authorization", `Bearer ${firstToken}`).expect(200);
    await request(httpServer).post(url("/me/connections")).set("Authorization", `Bearer ${firstToken}`)
      .send({ addresseeId: secondId }).expect(201);
  });

  it("serializes a connection request against a simultaneous block", async () => {
    const [connect, block] = await Promise.all([
      request(httpServer).post(url("/me/connections")).set("Authorization", `Bearer ${thirdToken}`)
        .send({ addresseeId: fourthId }),
      request(httpServer).post(url("/me/blocks")).set("Authorization", `Bearer ${fourthToken}`)
        .send({ targetUserId: thirdId }),
    ]);
    expect([201, 404]).toContain(connect.status);
    expect(block.status).toBe(201);
    const requests = await request(httpServer).get(url("/me/connections?status=PENDING"))
      .set("Authorization", `Bearer ${thirdToken}`).expect(200);
    expect(requests.body.data).toHaveLength(0);
  });
});
