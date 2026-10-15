import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";

import { mkdtemp, rm } from "fs/promises";
import { randomUUID } from "crypto";

import request from "supertest";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";
import { ChatEventsService } from "../../src/modules/chat/chat-events.service";
import { MessageModel } from "../../src/modules/chat/message.model";

describe("H7 server edit deadline", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let isolatedMediaRoot: string | undefined;
  const originalMediaProvider = env.MEDIA_STORAGE_PROVIDER;
  const originalMediaRoot = env.MEDIA_STORAGE_LOCAL_ROOT;
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    isolatedMediaRoot = await mkdtemp("/tmp/gymsheet-h7-chat-media-");
    env.MEDIA_STORAGE_PROVIDER = "local";
    env.MEDIA_STORAGE_LOCAL_ROOT = isolatedMediaRoot;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix(env.API_PREFIX);
    app.use(requestIdMiddleware);
    app.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    app.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    server = app.getHttpServer();
  }, 60000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      env.MEDIA_STORAGE_PROVIDER = originalMediaProvider;
      env.MEDIA_STORAGE_LOCAL_ROOT = originalMediaRoot;
      if (isolatedMediaRoot) await rm(isolatedMediaRoot, { recursive: true, force: true });
    }
  });

  async function register(label: string) {
    const response = await request(server).post(url("/auth/register")).send({
      email: `h7-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      password: "e2e-strong-password",
      nombreCompleto: `H7 ${label}`,
      acceptedTerms: true,
    }).expect(201);
    return { token: response.body.data.accessToken as string, id: response.body.data.user.id as string };
  }

  async function connect(a: Awaited<ReturnType<typeof register>>, b: Awaited<ReturnType<typeof register>>) {
    const connected = await request(server).post(url("/me/connections"))
      .set("Authorization", `Bearer ${a.token}`).send({ addresseeId: b.id }).expect(201);
    await request(server).patch(url(`/me/connections/${connected.body.data.id}`))
      .set("Authorization", `Bearer ${b.token}`).send({ action: "ACCEPT" }).expect(200);
    const started = await request(server).post(url("/me/conversations"))
      .set("Authorization", `Bearer ${a.token}`).send({ otherUserId: b.id }).expect(201);
    return {
      connectionId: connected.body.data.id as string,
      conversationId: started.body.data.conversationId as string,
    };
  }

  let legacyFixture: Promise<{
    a: Awaited<ReturnType<typeof register>>;
    conversationId: string;
  }> | undefined;

  it.each([
    { edited: false, retryBody: "legacy original", status: 201 },
    { edited: false, retryBody: "different payload", status: 409 },
    { edited: true, retryBody: "legacy edited", status: 409 },
    { edited: true, retryBody: "legacy original", status: 409 },
  ])("H7.S2.M1 legacy writer missing snapshot: edited=$edited retry=$retryBody returns $status", async ({ edited, retryBody, status }) => {
    legacyFixture ??= (async () => {
      const a = await register("legacy-edit-a");
      const b = await register("legacy-edit-b");
      const { conversationId } = await connect(a, b);
      return { a, conversationId };
    })();
    const { a, conversationId } = await legacyFixture;
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const clientRequestId = randomUUID();
    const send = (body: string) => request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body, clientRequestId });
    const sentEvents = jest.spyOn(app.get(ChatEventsService), "emitMessage");
    try {
      const first = await send("legacy original").expect(201);
      if (edited) await request(server).patch(`${messagesUrl}/${first.body.data.id}`)
        .set("Authorization", `Bearer ${a.token}`).send({ body: "legacy edited" }).expect(200);
      // An old process in a rolling deploy omits the new snapshot column.
      await MessageModel.update({ idempotencyBody: null }, { where: { id: first.body.data.id } });
      const before = await MessageModel.findByPk(first.body.data.id);
      const replay = await send(retryBody).expect(status);
      if (status === 201) expect(replay.body.data).toEqual(first.body.data);
      const after = await MessageModel.findByPk(first.body.data.id);
      expect(after?.body).toBe(before?.body);
      expect(after?.editedAt).toEqual(before?.editedAt);
      expect(await MessageModel.count({ where: { conversationId, senderId: a.id, clientRequestId } })).toBe(1);
      expect(sentEvents).toHaveBeenCalledTimes(1);
    } finally {
      sentEvents.mockRestore();
    }
  }, 60000);

  it.each([
    { retryBody: "original request", status: 201 },
    { retryBody: "edited text", status: 409 },
  ])("H7.S2.M1 idempotent replay after edit: $retryBody returns $status", async ({ retryBody, status }) => {
    const a = await register("retry-edit-a");
    const b = await register("retry-edit-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const payload = { body: "original request", clientRequestId: "00000000-0000-4000-8000-000000000071" };
    const send = (body: string) => request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ ...payload, body });
    const events = app.get(ChatEventsService);
    const sentEvents = jest.spyOn(events, "emitMessage");
    const editEvents = jest.spyOn(events, "emitMessageUpdated");
    try {
      const first = await send(payload.body).expect(201);
      const edited = await request(server).patch(`${messagesUrl}/${first.body.data.id}`)
        .set("Authorization", `Bearer ${a.token}`).send({ body: "edited text" }).expect(200);
      const replay = await send(retryBody).expect(status);
      if (status === 201) expect(replay.body.data).toEqual(edited.body.data);
      expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
      const persisted = await MessageModel.findByPk(first.body.data.id);
      expect(persisted?.body).toBe("edited text");
      expect(persisted?.idempotencyBody).toBe("original request");
      expect(persisted?.editedAt?.toISOString()).toBe(edited.body.data.editedAt);
      expect(sentEvents).toHaveBeenCalledTimes(1);
      expect(editEvents).toHaveBeenCalledTimes(1);
      await request(server).post(url("/me/blocks")).set("Authorization", `Bearer ${b.token}`)
        .send({ targetUserId: a.id }).expect(201);
      expect([403, 404]).toContain((await send(payload.body)).status);
      expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
      expect(sentEvents).toHaveBeenCalledTimes(1);
      expect(editEvents).toHaveBeenCalledTimes(1);
    } finally {
      sentEvents.mockRestore();
      editEvents.mockRestore();
    }
  }, 60000);

  it("H7.S2.M1 accepts own text at 14:59 and 15:00, rejects 15:01 without restarting the deadline", async () => {
    const a = await register("edit-a");
    const b = await register("edit-b");
    const outsider = await register("edit-outsider");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "original" }).expect(201);
    expect(sent.body.data.editedAt).toBeNull();
    const id = sent.body.data.id as string;
    const createdAt = new Date(Date.now() - 900000);
    await MessageModel.update({ createdAt }, { where: { id } });
    const clock = jest.spyOn(Date, "now");
    const edit = (body: object, token = a.token) => request(server).patch(`${messagesUrl}/${id}`)
      .set("Authorization", `Bearer ${token}`).send(body);
    try {
      for (const seconds of [899, 900]) {
        clock.mockReturnValue(createdAt.getTime() + seconds * 1000);
        const edited = await edit({ body: `edit-${seconds}` }).expect(200);
        expect(edited.body.data).toEqual(expect.objectContaining({
          id, body: `edit-${seconds}`, createdAt: createdAt.toISOString(),
          editedAt: new Date(createdAt.getTime() + seconds * 1000).toISOString(),
        }));
        const history = await request(server).get(messagesUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
        expect(history.body.data).toEqual([expect.objectContaining({ id, body: `edit-${seconds}`, editedAt: edited.body.data.editedAt })]);
      }
      clock.mockReturnValue(createdAt.getTime() + 900001);
      await edit({ body: "expired-by-one-millisecond" }).expect(400);
      clock.mockReturnValue(createdAt.getTime() + 901000);
      await edit({ body: "expired" }).expect(400);
      const persisted = await MessageModel.findByPk(id);
      expect(persisted?.body).toBe("edit-900");
      expect(persisted?.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(persisted?.get("editedAt")).toEqual(new Date(createdAt.getTime() + 900000));
      clock.mockReturnValue(createdAt.getTime() + 899000);
      await edit({ body: "foreign" }, b.token).expect(404);
      await edit({ body: "foreign" }, outsider.token).expect(404);
      for (const body of ["", "   ", "a".repeat(4001)]) await edit({ body }).expect(400);
      await edit({ body: "forged", createdAt: createdAt.toISOString() }).expect(400);
      await edit({ body: "forged", serverNow: createdAt.toISOString() }).expect(400);
      const sticker = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
        .send({ type: "sticker", stickerId: "gym.cheer.v1" }).expect(201);
      await request(server).patch(`${messagesUrl}/${sticker.body.data.id}`).set("Authorization", `Bearer ${a.token}`)
        .send({ body: "convert sticker" }).expect(400);
      await request(server).post(url("/me/blocks")).set("Authorization", `Bearer ${b.token}`).send({ targetUserId: a.id }).expect(201);
      expect([403, 404]).toContain((await edit({ body: "blocked" })).status);
      expect((await MessageModel.findByPk(id))?.body).toBe("edit-900");
    } finally {
      clock.mockRestore();
    }
  }, 60000);
});
