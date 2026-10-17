import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";
import { readFileSync } from "fs";
import { mkdtemp, readdir, rm } from "fs/promises";
import { join } from "path";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";
import { ChatEventsService } from "../../src/modules/chat/chat-events.service";

describe("H7 chat audio persistence", () => {
  let app: INestApplication | undefined;
  let server: Parameters<typeof request>[0];
  let isolatedMediaRoot: string | undefined;
  const originalMediaProvider = env.MEDIA_STORAGE_PROVIDER;
  const originalMediaRoot = env.MEDIA_STORAGE_LOCAL_ROOT;
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  async function startApp() {
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
  }

  beforeAll(async () => {
    isolatedMediaRoot = await mkdtemp("/tmp/gymsheet-h7-audio-media-");
    env.MEDIA_STORAGE_PROVIDER = "local";
    env.MEDIA_STORAGE_LOCAL_ROOT = isolatedMediaRoot;
    await startApp();
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
      email: `h7-audio-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      password: "e2e-strong-password",
      nombreCompleto: `H7 audio ${label}`,
      acceptedTerms: true,
    }).expect(201);
    return { token: response.body.data.accessToken as string, id: response.body.data.user.id as string };
  }

  it("persists an allowed audio message and serves it privately after the API restarts", async () => {
    const audio = readFileSync(join(__dirname, "../../src/modules/chat/fixtures/valid-audio.m4a"));
    const a = await register("sender");
    const b = await register("recipient");
    const connected = await request(server).post(url("/me/connections"))
      .set("Authorization", `Bearer ${a.token}`).send({ addresseeId: b.id }).expect(201);
    await request(server).patch(url(`/me/connections/${connected.body.data.id}`))
      .set("Authorization", `Bearer ${b.token}`).send({ action: "ACCEPT" }).expect(200);
    const started = await request(server).post(url("/me/conversations"))
      .set("Authorization", `Bearer ${a.token}`).send({ otherUserId: b.id }).expect(201);
    const conversationId = started.body.data.conversationId as string;

    const sent = await request(server).post(url(`/me/conversations/${conversationId}/messages/media`))
      .set("Authorization", `Bearer ${a.token}`)
      .field("type", "audio")
      .attach("file", audio, { filename: "voice.m4a", contentType: "audio/mp4" });
    if (sent.status !== 201) throw new Error(`Audio upload response ${sent.status}: ${JSON.stringify(sent.body)}`);
    expect(sent.body.data).toEqual(expect.objectContaining({ type: "audio", mediaMimeType: "audio/mp4" }));
    expect(sent.body.data.mediaUrl).toBe(`/me/conversations/${conversationId}/messages/${sent.body.data.id}/media`);
    expect(sent.body.data.mediaUrl).not.toContain("http");
    expect(await readdir(isolatedMediaRoot as string)).toContain("users");

    await app?.close();
    app = undefined;
    await startApp();

    const history = await request(server).get(url(`/me/conversations/${conversationId}/messages`))
      .set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(history.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sent.body.data.id, type: "audio", mediaUrl: sent.body.data.mediaUrl }),
    ]));

    const mediaUrl = url(sent.body.data.mediaUrl as string);
    await request(server).get(mediaUrl).expect(401);
    const downloaded = await request(server).get(mediaUrl)
      .set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(downloaded.headers["content-type"]).toMatch(/^audio\/mp4/);
    expect(Buffer.isBuffer(downloaded.body)).toBe(true);
    expect(downloaded.body as Buffer).toEqual(audio);
    expect(downloaded.headers["accept-ranges"]).toBe("bytes");

    // AVPlayer (iOS) sondea con `bytes=0-1` y exige 206: con 200 la nota de voz no suena.
    const probe = await request(server).get(mediaUrl)
      .set("Authorization", `Bearer ${b.token}`).set("Range", "bytes=0-1").expect(206);
    expect(probe.headers["content-range"]).toBe(`bytes 0-1/${audio.length}`);
    expect(probe.body as Buffer).toEqual(audio.subarray(0, 2));
    const tail = await request(server).get(mediaUrl)
      .set("Authorization", `Bearer ${b.token}`).set("Range", `bytes=${audio.length - 10}-`).expect(206);
    expect(tail.body as Buffer).toEqual(audio.subarray(audio.length - 10));
    await request(server).get(mediaUrl)
      .set("Authorization", `Bearer ${b.token}`).set("Range", `bytes=${audio.length}-`).expect(416);

    await request(server).post(url("/me/blocks"))
      .set("Authorization", `Bearer ${b.token}`).send({ targetUserId: a.id }).expect(201);
    const revokedDownload = await request(server).get(mediaUrl)
      .set("Authorization", `Bearer ${b.token}`);
    expect([403, 404]).toContain(revokedDownload.status);
  }, 60000);

  it("H7.S2.M5 revokes a recipient's saved audio URL and publishes only the tombstone after global deletion", async () => {
    const audio = readFileSync(join(__dirname, "../../src/modules/chat/fixtures/valid-audio.m4a"));
    const a = await register("delete-audio-sender");
    const b = await register("delete-audio-recipient");
    const connected = await request(server).post(url("/me/connections"))
      .set("Authorization", `Bearer ${a.token}`).send({ addresseeId: b.id }).expect(201);
    await request(server).patch(url(`/me/connections/${connected.body.data.id}`))
      .set("Authorization", `Bearer ${b.token}`).send({ action: "ACCEPT" }).expect(200);
    const started = await request(server).post(url("/me/conversations"))
      .set("Authorization", `Bearer ${a.token}`).send({ otherUserId: b.id }).expect(201);
    const conversationId = started.body.data.conversationId as string;
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${a.token}`)
      .field("type", "audio").attach("file", audio, { filename: "delete-me.m4a", contentType: "audio/mp4" }).expect(201);
    const mediaUrl = url(sent.body.data.mediaUrl as string);
    await request(server).get(mediaUrl).set("Authorization", `Bearer ${b.token}`).expect(200);

    const events = app!.get(ChatEventsService);
    const deleted = jest.spyOn(events, "emitMessageDeleted");
    const published = jest.spyOn(events, "emitMessage");
    try {
      const tombstone = await request(server).delete(`${messagesUrl}/${sent.body.data.id}?scope=EVERYONE`)
        .set("Authorization", `Bearer ${a.token}`).expect(200);
      expect(tombstone.body.data).toMatchObject({ id: sent.body.data.id, body: "Mensaje eliminado", type: "text", mediaUrl: null });
      expect(deleted).toHaveBeenCalledTimes(1);
      expect(Object.keys(deleted.mock.calls[0][0]).sort()).toEqual(["conversationId", "deletedAt", "messageId", "scope"]);
      expect(published).not.toHaveBeenCalled();

      await request(server).get(mediaUrl).set("Authorization", `Bearer ${b.token}`).expect(404);
      const history = await request(server).get(messagesUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
      expect(history.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: sent.body.data.id, body: "Mensaje eliminado", mediaUrl: null, type: "text" }),
      ]));
    } finally { deleted.mockRestore(); published.mockRestore(); }
  }, 60000);
});
