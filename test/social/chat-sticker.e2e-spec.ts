import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";

import { mkdtemp, readdir, rm } from "fs/promises";

import { createServer, Server } from "http";
import { AddressInfo } from "net";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";
import { ChatEventsService } from "../../src/modules/chat/chat-events.service";
import { MessageModel } from "../../src/modules/chat/message.model";

describe("H7 catalog sticker persistence", () => {
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

  it("H7.S1.M3 persists catalog stickers, deduplicates retries, rejects arbitrary content and revalidates access", async () => {
    const a = await register("sticker-a");
    const b = await register("sticker-b");
    const outsider = await register("sticker-outsider");
    const { conversationId } = await connect(a, b);
    const messageUrl = url(`/me/conversations/${conversationId}/messages`);
    const clientRequestId = "00000000-0000-4000-8000-000000000033";
    const send = (payload: object, token = a.token) => request(server).post(messageUrl)
      .set("Authorization", `Bearer ${token}`).send(payload);
    const payload = { type: "sticker", stickerId: "gym.cheer.v1", clientRequestId };
    const emit = jest.spyOn(app.get(ChatEventsService), "emitMessage");
    const first = await send(payload);
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual(expect.objectContaining({ type: "sticker", body: "gym.cheer.v1", stickerId: "gym.cheer.v1", mediaUrl: null }));
    const retry = await send(payload);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
    expect((await send({ ...payload, stickerId: "gym.strong.v1" })).status).toBe(409);

    let fetched = 0;
    const trap: Server = createServer((_req, res) => { fetched++; res.end("arbitrary-content"); });
    await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve));
    const arbitraryUrl = `http://127.0.0.1:${(trap.address() as AddressInfo).port}/sticker.png`;
    try {
      for (const rejected of [
        { type: "sticker", stickerId: "unknown" },
        { type: "sticker", stickerId: arbitraryUrl },
        { type: "sticker", url: arbitraryUrl },
        { ...payload, url: arbitraryUrl },
        { ...payload, body: arbitraryUrl },
      ]) expect((await send(rejected)).status).toBe(400);
      expect(fetched).toBe(0);
      expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
      expect(await readdir(isolatedMediaRoot as string)).toEqual([]);
      expect(emit).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) => trap.close(error => error ? reject(error) : resolve()));
    }
    const history = await request(server).get(messageUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(history.body.data).toEqual([expect.objectContaining({ id: first.body.data.id, type: "sticker", stickerId: "gym.cheer.v1" })]);
    const summaries = await request(server).get(url("/me/conversations")).set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(summaries.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ conversationId, lastMessage: "Sticker" })]));
    expect((await send(payload, outsider.token)).status).toBe(404);
    await request(server).post(url("/me/blocks")).set("Authorization", `Bearer ${b.token}`).send({ targetUserId: a.id }).expect(201);
    expect([403, 404]).toContain((await send(payload)).status);
    expect([403, 404]).toContain((await send({ type: "sticker", stickerId: "gym.strong.v1" })).status);
    expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
    emit.mockRestore();
  }, 60000);
});
