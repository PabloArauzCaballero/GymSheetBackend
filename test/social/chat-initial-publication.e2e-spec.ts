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

describe("H7 initial message publication visibility", () => {
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

  it.each(["post-commit send", "push preparation"] as const)(
    "H7.S2.M3 suppresses hidden message publication delayed at %s",
    async stage => {
      const a = await register("publication-recipient");
      const b = await register("publication-sender");
      const { conversationId } = await connect(a, b);
      const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
      const payload = { body: "Mensaje pendiente que A oculta", clientRequestId: "00000000-0000-4000-8000-000000000093" };
      const send = () => request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`).send(payload);
      const repository = app.get(ChatRepository);
      const emitted = jest.spyOn(app.get(ChatEventsService), "emitMessage");
      const push = jest.spyOn(app.get(PushDispatcherService), "sendToUser")
        .mockResolvedValue({ delivered: 0, deactivated: 0, skipped: 0 });
      let signalPause!: () => void;
      let release!: () => void;
      const paused = new Promise<void>(resolve => { signalPause = resolve; });
      const resume = new Promise<void>(resolve => { release = resolve; });
      const originalCreate = repository.createMessageIdempotent.bind(repository);
      const originalRecipients = repository.listOtherParticipants.bind(repository);
      const barrier = stage === "post-commit send"
        ? jest.spyOn(repository, "createMessageIdempotent").mockImplementation(async (...args) => {
          const result = await originalCreate(...args);
          signalPause();
          await resume;
          return result;
        })
        : jest.spyOn(repository, "listOtherParticipants").mockImplementation(async (...args) => {
          const result = await originalRecipients(...args);
          signalPause();
          await resume;
          return result;
        });
      let sending: Promise<request.Response> | undefined;
      try {
        sending = send().then(response => response);
        await paused;
        const known = await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200);
        expect(known.body.data).toHaveLength(1);
        const messageId = known.body.data[0].id as string;
        expect(emitted).toHaveBeenCalledTimes(stage === "post-commit send" ? 0 : 1);
        await request(server).delete(`${messagesUrl}/${messageId}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(200);
        release();
        expect((await sending).status).toBe(201);
        expect(emitted).toHaveBeenCalledTimes(stage === "post-commit send" ? 0 : 1);
        expect(push).not.toHaveBeenCalled();
        expect((await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200)).body.data).toEqual([]);
        const replay = await send().expect(201);
        expect(replay.body.data.id).toBe(messageId);
        expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
        expect(emitted).toHaveBeenCalledTimes(stage === "post-commit send" ? 0 : 1);
        expect(push).not.toHaveBeenCalled();
      } finally {
        release();
        await Promise.allSettled([sending].filter((promise): promise is Promise<request.Response> => promise !== undefined));
        barrier.mockRestore();
        emitted.mockRestore();
        push.mockRestore();
      }
    }, 60000,
  );

  it("H7.S2.M3 releases the publication lock while an initiated push is still pending", async () => {
    const a = await register("inflight-recipient");
    const b = await register("inflight-sender");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    let signalInitiated!: () => void;
    let releaseDelivery!: () => void;
    const initiated = new Promise<void>(resolve => { signalInitiated = resolve; });
    const delivery = new Promise<{ delivered: number; deactivated: number; skipped: number }>(resolve => {
      releaseDelivery = () => resolve({ delivered: 0, deactivated: 0, skipped: 0 });
    });
    const push = jest.spyOn(app.get(PushDispatcherService), "sendToUser").mockImplementation(() => {
      signalInitiated();
      return delivery;
    });
    let sendComplete = false;
    const sending = request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`)
      .send({ body: "Push iniciado antes de ocultar", clientRequestId: "00000000-0000-4000-8000-000000000095" })
      .then(response => { sendComplete = true; return response; });
    try {
      await initiated;
      const known = await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200);
      const messageId = known.body.data[0].id as string;
      // Hide must finish before the pending dispatcher promise is released.
      await request(server).delete(`${messagesUrl}/${messageId}?scope=ME`).set("Authorization", `Bearer ${a.token}`)
        .timeout({ response: 5000 }).expect(200);
      expect(sendComplete).toBe(false);
      expect(push).toHaveBeenCalledTimes(1);
      releaseDelivery();
      expect((await sending).status).toBe(201);
      expect((await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200)).body.data).toEqual([]);
    } finally {
      releaseDelivery();
      await Promise.allSettled([sending]);
      push.mockRestore();
    }
  }, 60000);

  it("H7.S2.M3 preserves visible send event/push and does not repeat them for idempotent retries", async () => {
    const a = await register("visible-recipient");
    const b = await register("visible-sender");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const payload = { body: "Mensaje visible normal", clientRequestId: "00000000-0000-4000-8000-000000000094" };
    const emitted = jest.spyOn(app.get(ChatEventsService), "emitMessage");
    const push = jest.spyOn(app.get(PushDispatcherService), "sendToUser")
      .mockResolvedValue({ delivered: 0, deactivated: 0, skipped: 0 });
    try {
      const send = () => request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`).send(payload);
      const first = await send().expect(201);
      const replay = await send().expect(201);
      expect(replay.body.data).toEqual(first.body.data);
      expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ id: first.body.data.id, body: payload.body }));
      expect(push).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith(a.id, { title: expect.any(String), body: payload.body, url: `/chat/${conversationId}` });
    } finally {
      emitted.mockRestore();
      push.mockRestore();
    }
  }, 60000);
});
