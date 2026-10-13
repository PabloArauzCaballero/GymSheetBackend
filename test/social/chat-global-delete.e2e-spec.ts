import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../../src/modules/media/media-storage.port";
import { readFileSync } from "fs";
import { join } from "path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";

import { mkdtemp, rm } from "fs/promises";

import request from "supertest";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";
import { ChatEventsService } from "../../src/modules/chat/chat-events.service";
import { ChatRepository } from "../../src/modules/chat/chat.repository";
import { PushDispatcherService } from "../../src/modules/notifications/delivery/push-dispatcher.service";
import { MessageModel } from "../../src/modules/chat/message.model";

describe("H7 global message deletion", () => {
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

  it("H7.S2.M4 preserves local hiding, revokes media, and emits only tombstone metadata once", async () => {
    const a = await register("global-media-a"), b = await register("global-media-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${b.token}`)
      .field("type", "image").field("viewOnce", "true").field("body", "Pie privado")
      .attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
        filename: "global-delete.jpg", contentType: "image/jpeg",
      }).expect(201);
    const messageId = sent.body.data.id;
    await request(server).delete(`${messagesUrl}/${messageId}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(200);
    const deleted = jest.spyOn(app.get(ChatEventsService), "emitMessageDeleted");
    try {
      const result = await request(server).delete(`${messagesUrl}/${messageId}?scope=EVERYONE`).set("Authorization", `Bearer ${b.token}`).expect(200);
      expect(result.body.data).toMatchObject({ body: "Mensaje eliminado", type: "text", mediaUrl: null, mediaMimeType: null, viewOnce: false });
      expect(deleted).toHaveBeenCalledTimes(1);
      expect(Object.keys(deleted.mock.calls[0][0]).sort()).toEqual(["conversationId", "deletedAt", "messageId", "scope"]);
      await request(server).delete(`${messagesUrl}/${messageId}?scope=EVERYONE`).set("Authorization", `Bearer ${b.token}`).expect(200);
      expect(deleted).toHaveBeenCalledTimes(1);
      for (const token of [a.token, b.token]) {
        await request(server).get(`${messagesUrl}/${messageId}/media`).set("Authorization", `Bearer ${token}`).expect(404);
        await request(server).post(`${messagesUrl}/${messageId}/view`).set("Authorization", `Bearer ${token}`).expect(404);
      }
      await request(server).patch(`${messagesUrl}/${messageId}`).set("Authorization", `Bearer ${b.token}`).send({ body: "Revive" }).expect(404);
      expect((await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200)).body.data).toEqual([]);
      expect((await request(server).get(messagesUrl).set("Authorization", `Bearer ${b.token}`).expect(200)).body.data).toEqual([expect.objectContaining({ id: messageId, body: "Mensaje eliminado" })]);
      expect((await request(server).get(url("/me/conversations")).set("Authorization", `Bearer ${b.token}`).expect(200)).body.data)
        .toEqual(expect.arrayContaining([expect.objectContaining({ conversationId, lastMessage: "Mensaje eliminado" })]));
      expect((await MessageModel.findByPk(messageId))?.toJSON()).toMatchObject({ body: null, idempotencyBody: null, mediaKey: null, mediaUrl: null, mediaProvider: null, locationLat: null, locationLng: null, editedAt: null });
      await request(server).post(url("/me/blocks")).set("Authorization", `Bearer ${a.token}`).send({ targetUserId: b.id }).expect(201);
      await request(server).delete(`${messagesUrl}/${messageId}?scope=EVERYONE`).set("Authorization", `Bearer ${b.token}`).expect(404);
    } finally { deleted.mockRestore(); }
  }, 60000);

  it("H7.S2.M4 retries the original location digest and fails closed for an edited legacy row without snapshot", async () => {
    const a = await register("global-hash-a"), b = await register("global-hash-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const post = (payload: object) => request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`).send(payload);
    const location = { type: "location", locationLat: 0, locationLng: -0, clientRequestId: "00000000-0000-4000-8000-000000000201" };
    const sent = await post(location).expect(201);
    await request(server).delete(`${messagesUrl}/${sent.body.data.id}?scope=EVERYONE`).set("Authorization", `Bearer ${a.token}`).expect(200);
    expect((await post(location).expect(201)).body.data).toMatchObject({ id: sent.body.data.id, body: "Mensaje eliminado", locationLat: null, locationLng: null });
    await post({ ...location, locationLat: 0.001 }).expect(409);
    await post({ body: "0", clientRequestId: location.clientRequestId }).expect(409);
    const original = { body: "Original irrecuperable", clientRequestId: "00000000-0000-4000-8000-000000000202" };
    const legacy = await post(original).expect(201);
    await request(server).patch(`${messagesUrl}/${legacy.body.data.id}`).set("Authorization", `Bearer ${a.token}`).send({ body: "Editado antiguo" }).expect(200);
    await MessageModel.update({ idempotencyBody: null }, { where: { id: legacy.body.data.id } });
    await request(server).delete(`${messagesUrl}/${legacy.body.data.id}?scope=EVERYONE`).set("Authorization", `Bearer ${a.token}`).expect(200);
    expect((await MessageModel.findByPk(legacy.body.data.id))?.deletedRequestHash).toBeNull();
    await post(original).expect(409);
    await post({ ...original, body: "Editado antiguo" }).expect(409);
    const editedPayload = { body: "Original recuperable", clientRequestId: "00000000-0000-4000-8000-000000000204" };
    const edited = await post(editedPayload).expect(201);
    const repository = app.get(ChatRepository), originalPublish = repository.publishMessageIfVisible.bind(repository);
    let signalEdit!: () => void, releaseEdit!: () => void;
    const editPaused = new Promise<void>(resolve => { signalEdit = resolve; });
    const editResume = new Promise<void>(resolve => { releaseEdit = resolve; });
    const editBarrier = jest.spyOn(repository, "publishMessageIfVisible").mockImplementation(async (...args) => {
      signalEdit(); await editResume; return originalPublish(...args);
    });
    const updates = jest.spyOn(app.get(ChatEventsService), "emitMessageUpdated");
    let editing: Promise<request.Response> | undefined;
    try {
      editing = request(server).patch(`${messagesUrl}/${edited.body.data.id}`).set("Authorization", `Bearer ${a.token}`)
        .send({ body: "Texto mutado" }).then(response => response);
      await editPaused;
      await request(server).delete(`${messagesUrl}/${edited.body.data.id}?scope=EVERYONE`).set("Authorization", `Bearer ${a.token}`).expect(200);
      releaseEdit();
      const finishedEdit = await editing;
      expect(finishedEdit.status).toBe(200);
      expect(finishedEdit.body.data).toMatchObject({ body: "Mensaje eliminado", editedAt: null, deletedAt: expect.any(String) });
      expect(updates).not.toHaveBeenCalled();
    } finally { releaseEdit(); await Promise.allSettled([editing].filter(Boolean)); editBarrier.mockRestore(); updates.mockRestore(); }
    expect((await post(editedPayload).expect(201)).body.data.body).toBe("Mensaje eliminado");
    await post({ ...editedPayload, body: "Texto mutado" }).expect(409);
    expect(await MessageModel.count({ where: { conversationId } })).toBe(3);
  }, 60000);

  it.each(["post-commit send", "push preparation"] as const)("H7.S2.M4 suppresses global deleted publication delayed at %s", async stage => {
    const a = await register("global-race-a"), b = await register("global-race-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const payload = { body: "No publicar tras tombstone", clientRequestId: "00000000-0000-4000-8000-000000000203" };
    const repository = app.get(ChatRepository);
    const emitted = jest.spyOn(app.get(ChatEventsService), "emitMessage");
    const push = jest.spyOn(app.get(PushDispatcherService), "sendToUser").mockResolvedValue({ delivered: 0, deactivated: 0, skipped: 0 });
    let signalPause!: () => void, release!: () => void;
    const paused = new Promise<void>(resolve => { signalPause = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const originalCreate = repository.createMessageIdempotent.bind(repository), originalRecipients = repository.listOtherParticipants.bind(repository);
    const barrier = stage === "post-commit send"
      ? jest.spyOn(repository, "createMessageIdempotent").mockImplementation(async (...args) => { const result = await originalCreate(...args); signalPause(); await resume; return result; })
      : jest.spyOn(repository, "listOtherParticipants").mockImplementation(async (...args) => { const result = await originalRecipients(...args); signalPause(); await resume; return result; });
    let sending: Promise<request.Response> | undefined;
    try {
      sending = request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`).send(payload).then(response => response);
      await paused;
      const history = await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200);
      const messageId = history.body.data[0].id;
      await request(server).delete(`${messagesUrl}/${messageId}?scope=EVERYONE`).set("Authorization", `Bearer ${b.token}`).expect(200);
      release();
      const completed = await sending;
      expect(completed.status).toBe(201);
      expect(completed.body.data).toMatchObject({ id: messageId, body: "Mensaje eliminado", deletedAt: expect.any(String) });
      expect(emitted).toHaveBeenCalledTimes(stage === "post-commit send" ? 0 : 1);
      expect(push).not.toHaveBeenCalled();
      const replay = await request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`).send(payload).expect(201);
      expect(replay.body.data).toMatchObject({ id: messageId, body: "Mensaje eliminado" });
      expect(emitted).toHaveBeenCalledTimes(stage === "post-commit send" ? 0 : 1);
      expect(push).not.toHaveBeenCalled();
    } finally {
      release(); await Promise.allSettled([sending].filter(Boolean)); barrier.mockRestore(); emitted.mockRestore(); push.mockRestore();
    }
  }, 60000);
  it("H7.S2.M4 denies media whose download started before global deletion confirmed", async () => {
    const a = await register("global-download-a"), b = await register("global-download-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${b.token}`)
      .field("type", "image").attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
        filename: "global-download.jpg", contentType: "image/jpeg",
      }).expect(201);
    const storage = app.get<MediaStorageProvider>(MEDIA_STORAGE_PROVIDER), original = storage.download.bind(storage);
    let signalPause!: () => void, release!: () => void;
    const paused = new Promise<void>(resolve => { signalPause = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const barrier = jest.spyOn(storage, "download").mockImplementation(async key => {
      const result = await original(key); signalPause(); await resume; return result;
    });
    let downloading: Promise<request.Response> | undefined;
    try {
      downloading = request(server).get(`${messagesUrl}/${sent.body.data.id}/media`).set("Authorization", `Bearer ${a.token}`).then(response => response);
      await paused;
      await request(server).delete(`${messagesUrl}/${sent.body.data.id}?scope=EVERYONE`).set("Authorization", `Bearer ${b.token}`).expect(200);
      release();
      expect((await downloading).status).toBe(404);
    } finally { release(); await Promise.allSettled([downloading].filter(Boolean)); barrier.mockRestore(); }
  }, 60000);

  it("H7.S2.M4 does not return a stale view-once snapshot after global deletion", async () => {
    const a = await register("global-view-race-a"), b = await register("global-view-race-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${b.token}`)
      .field("type", "image").field("viewOnce", "true").field("body", "Caption privado")
      .attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
        filename: "global-view-race.jpg", contentType: "image/jpeg",
      }).expect(201);
    const messageId = sent.body.data.id as string;
    const repository = app.get(ChatRepository), original = repository.tryMarkMessageViewed.bind(repository);
    let signalView!: () => void, releaseView!: () => void;
    const viewPaused = new Promise<void>(resolve => { signalView = resolve; });
    const viewResume = new Promise<void>(resolve => { releaseView = resolve; });
    const barrier = jest.spyOn(repository, "tryMarkMessageViewed").mockImplementation(async (...args) => {
      const result = await original(...args); signalView(); await viewResume; return result;
    });
    let viewing: Promise<request.Response> | undefined;
    try {
      viewing = request(server).post(`${messagesUrl}/${messageId}/view`).set("Authorization", `Bearer ${a.token}`).then(response => response);
      await viewPaused;
      await request(server).delete(`${messagesUrl}/${messageId}?scope=EVERYONE`).set("Authorization", `Bearer ${b.token}`).expect(200);
      releaseView();
      const response = await viewing;
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain("Caption privado");
      expect(JSON.stringify(response.body)).not.toContain("mediaUrl");
    } finally {
      releaseView(); await Promise.allSettled([viewing].filter(Boolean)); barrier.mockRestore();
    }
    expect((await MessageModel.findByPk(messageId))?.toJSON()).toMatchObject({ body: null, mediaKey: null, mediaUrl: null, viewedAt: null, deletedAt: expect.any(Date) });
  }, 60000);
});
