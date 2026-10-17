import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getModelToken } from "@nestjs/sequelize";
import { randomUUID } from "crypto";
import { json, urlencoded } from "express";
import { readFileSync } from "fs";
import { mkdtemp, readdir, rm } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import { Sequelize } from "sequelize-typescript";
import { QueryTypes } from "sequelize";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";

type ReadReceiptSettingsResponse = {
  enabled: boolean;
  defaultEnabled: boolean;
  conversationOverride: boolean | null;
  version: number;
};
import { ChatEventsService } from "../../src/modules/chat/chat-events.service";
import { ChatGateway } from "../../src/modules/chat/chat.gateway";
import { ConversationModel } from "../../src/modules/chat/conversation.model";
import { ChatRepository } from "../../src/modules/chat/chat.repository";
import { ChatService } from "../../src/modules/chat/chat.service";
import { MessageVisibilityModel } from "../../src/modules/chat/message-visibility.model";
import { MessageModel } from "../../src/modules/chat/message.model";
import { ReadReceiptSettingsService } from "../../src/modules/chat/read-receipt-settings.service";
import { SocialRepository } from "../../src/modules/social/social.repository";
import { runMigrations } from "../../src/database/migrate";
import { chatMessageGlobalDeleteMigration } from "../../src/database/migrations/202610090015-chat-message-global-delete";
import { databaseMigrations } from "../../src/database/migrations";

describe("H7 chat persistence", () => {
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
    await createApp();
  }, 60000);

  async function createApp() {
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

  it("H7.S1.M1 persists one message for concurrent retries, rejects changed payload, and checks access again", async () => {
    const a = await register("a");
    const b = await register("b");
    const outsider = await register("outsider");
    const { connectionId, conversationId } = await connect(a, b);
    const messageUrl = url(`/me/conversations/${conversationId}/messages`);
    const clientRequestId = "00000000-0000-4000-8000-000000000010";
    const send = (body: string, token = a.token) => request(server).post(messageUrl)
      .set("Authorization", `Bearer ${token}`).send({ body, clientRequestId });

    const [first, retry] = await Promise.all([send("Hola"), send("Hola")]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.clientRequestId).toBe(clientRequestId);

    const history = await request(server).get(messageUrl)
      .set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].id).toBe(first.body.data.id);
    expect((await send("Otro texto")).status).toBe(409);
    expect((await send("Hola", outsider.token)).status).toBe(404);

    await request(server).delete(url(`/me/connections/${connectionId}`))
      .set("Authorization", `Bearer ${a.token}`).expect(200);
    expect((await send("Hola")).status).toBe(404);
  }, 60000);

  it("H7.S5.M1 preserves legacy chat rows and rejects invalid global-delete hashes", async () => {
    const a = await register("migration-legacy-a");
    const b = await register("migration-legacy-b");
    const { conversationId } = await connect(a, b);
    const sequelize = app.get(Sequelize);
    const migration = chatMessageGlobalDeleteMigration;
    const legacyMessageId = randomUUID();

    // Run against the latest deployed schema inside a transaction: the down
    // step recreates the exact pre-015 shape, and rollback restores the shared
    // QA schema even if an assertion fails.
    await sequelize.transaction(async (transaction) => {
      await migration.down(sequelize.getQueryInterface(), transaction);
      await sequelize.query(
        `INSERT INTO chat.messages (id, conversation_id, sender_id, body, type)
         VALUES (:id, :conversationId, :senderId, :body, 'text')`,
        { transaction, replacements: {
          id: legacyMessageId,
          conversationId,
          senderId: a.id,
          body: "mensaje previo al esquema de borrado global",
        } },
      );

      await migration.up(sequelize.getQueryInterface(), transaction);

      const [preserved] = await sequelize.query<{ id: string; body: string; deleted_at: Date | null; deleted_request_hash: string | null }>(
        `SELECT id, body, deleted_at, deleted_request_hash FROM chat.messages WHERE id = :id`,
        { type: QueryTypes.SELECT, transaction, replacements: { id: legacyMessageId } },
      );
      expect(preserved).toEqual({
        id: legacyMessageId,
        body: "mensaje previo al esquema de borrado global",
        deleted_at: null,
        deleted_request_hash: null,
      });

      await expect(sequelize.query(
        `UPDATE chat.messages SET deleted_request_hash = 'invalid' WHERE id = :id`,
        { transaction, replacements: { id: legacyMessageId } },
      )).rejects.toMatchObject({ original: { code: "23514" } });
    });
  }, 60000);

  it("H7.S5.M2 rebuilds the migration chain on an empty database and loads a chat fixture", async () => {
    const originalDatabase = env.DB_NAME;
    const isolatedDatabase = `h7_s5_${randomUUID().replace(/-/g, "")}`;
    const admin = new Sequelize({
      dialect: "postgres",
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: "postgres",
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      logging: false,
      dialectOptions: {
        connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
        statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
        ...(env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : {}),
      },
    });

    try {
      await admin.query(`CREATE DATABASE "${isolatedDatabase}" TEMPLATE template0`);
      env.DB_NAME = isolatedDatabase;
      await runMigrations("up");

      const fresh = new Sequelize({
        dialect: "postgres",
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: isolatedDatabase,
        username: env.DB_USER,
        password: env.DB_PASSWORD,
        logging: false,
        dialectOptions: {
          connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
          statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
          ...(env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : {}),
        },
      });
      try {
        const migrations = await fresh.query<{ id: string }>(
          `SELECT id FROM app_meta.schema_migrations ORDER BY id`,
          { type: QueryTypes.SELECT },
        );
        expect(migrations.map(({ id }) => id)).toEqual(databaseMigrations.map(({ id }) => id).sort());

        const email = `h7-s5-fixture-${randomUUID()}@example.test`;
        const [user] = await fresh.query<{ id: string }>(
          `INSERT INTO public.usuarios (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'test-hash', 'H7 S5 Fixture', :tenantId) RETURNING id`,
          { type: QueryTypes.SELECT, replacements: { email, tenantId: env.DEFAULT_TENANT_ID } },
        );
        const [conversation] = await fresh.query<{ id: string }>(
          `INSERT INTO chat.conversations DEFAULT VALUES RETURNING id`,
          { type: QueryTypes.SELECT },
        );
        await fresh.query(
          `INSERT INTO chat.participants (conversation_id, user_id) VALUES (:conversationId, :userId)`,
          { replacements: { conversationId: conversation.id, userId: user.id } },
        );
        const [message] = await fresh.query<{ id: string; body: string; deleted_at: Date | null }>(
          `INSERT INTO chat.messages (conversation_id, sender_id, body)
           VALUES (:conversationId, :senderId, 'fresh database fixture')
           RETURNING id, body, deleted_at`,
          { type: QueryTypes.SELECT, replacements: { conversationId: conversation.id, senderId: user.id } },
        );
        expect(message).toMatchObject({ body: "fresh database fixture", deleted_at: null });
      } finally {
        await fresh.close();
      }
    } finally {
      env.DB_NAME = originalDatabase;
      await admin.query(`DROP DATABASE IF EXISTS "${isolatedDatabase}" WITH (FORCE)`);
      await admin.close();
    }
  }, 180000);

  it("H7.S3.M1 stores a per-conversation read receipt exception without changing another chat", async () => {
    const a = await register("receipt-exception-a");
    const b = await register("receipt-exception-b");
    const c = await register("receipt-exception-c");
    const ab = await connect(a, b);
    const ac = await connect(a, c);
    const settingsUrl = url("/me/chat/read-receipts");
    const settings = (conversationId?: string) => request(server).get(settingsUrl)
      .set("Authorization", `Bearer ${a.token}`)
      .query(conversationId ? { conversationId } : {});

    expect((await settings().expect(200)).body.data).toMatchObject({ enabled: true, defaultEnabled: true, conversationOverride: null, version: 0 });
    const updated = await request(server).put(settingsUrl).set("Authorization", `Bearer ${a.token}`).send({
      scope: "CONVERSATION", conversationId: ab.conversationId, enabled: false, expectedVersion: 0,
    }).expect(200);
    expect(updated.body.data).toMatchObject({ enabled: false, defaultEnabled: true, conversationOverride: false, version: 1 });
    expect((await settings(ab.conversationId).expect(200)).body.data)
      .toMatchObject({ enabled: false, defaultEnabled: true, conversationOverride: false, version: 1 });
    expect((await settings(ac.conversationId).expect(200)).body.data)
      .toMatchObject({ enabled: true, defaultEnabled: true, conversationOverride: null, version: 1 });
    expect((await app.get(Sequelize).query<{ conversation_id: string; read_receipts_enabled: boolean | null }>(
      `SELECT conversation_id, read_receipts_enabled FROM chat.participants
        WHERE user_id = :userId AND conversation_id IN (:ab, :ac) ORDER BY conversation_id`,
      { type: QueryTypes.SELECT, replacements: { userId: a.id, ab: ab.conversationId, ac: ac.conversationId } },
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ conversation_id: ab.conversationId, read_receipts_enabled: false }),
      expect.objectContaining({ conversation_id: ac.conversationId, read_receipts_enabled: null }),
    ]));
  }, 60000);

  it("H7.S3.M2 applies read receipt changes only to the selected conversations", async () => {
    const a = await register("receipt-selected-a");
    const b = await register("receipt-selected-b");
    const c = await register("receipt-selected-c");
    const d = await register("receipt-selected-d");
    const ab = await connect(a, b);
    const ac = await connect(a, c);
    const ad = await connect(a, d);
    const settingsUrl = url("/me/chat/read-receipts");
    const settings = (conversationId?: string) => request(server).get(settingsUrl)
      .set("Authorization", `Bearer ${a.token}`)
      .query(conversationId ? { conversationId } : {});
    const changedEvents = jest.spyOn(app.get(ChatEventsService), "emitReadReceiptSettingsChanged");
    const originalEnabledSince = new Date("2020-01-02T03:04:05.000Z");

    try {
      await app.get(Sequelize).query(
        `INSERT INTO chat.read_receipt_settings (user_id, enabled, version, enabled_since)
         VALUES (:userId, true, 0, :enabledSince)`,
        { replacements: { userId: a.id, enabledSince: originalEnabledSince },
        },
      );
      const adPolicyBefore = await app.get(ChatRepository).readReceiptPolicy(ad.conversationId);
      expect(adPolicyBefore).toMatchObject({ allowed: true, enabledSince: originalEnabledSince.toISOString() });
      const result = await request(server).put(settingsUrl).set("Authorization", `Bearer ${a.token}`).send({
        scope: "SELECTED",
        conversationIds: [ab.conversationId, ac.conversationId],
        enabled: false,
        expectedVersion: 0,
      }).expect(200);
      expect(result.body.data).toMatchObject({ defaultEnabled: true, version: 1 });
      expect(await settings(ab.conversationId).expect(200).then((response) => response.body.data as ReadReceiptSettingsResponse))
        .toMatchObject({ enabled: false, defaultEnabled: true, conversationOverride: false, version: 1 });
      expect(await settings(ac.conversationId).expect(200).then((response) => response.body.data as ReadReceiptSettingsResponse))
        .toMatchObject({ enabled: false, defaultEnabled: true, conversationOverride: false, version: 1 });
      expect(await settings(ad.conversationId).expect(200).then((response) => response.body.data as ReadReceiptSettingsResponse))
        .toMatchObject({ enabled: true, defaultEnabled: true, conversationOverride: null, version: 1 });

      const rows = await app.get(Sequelize).query<{ conversation_id: string; read_receipts_enabled: boolean | null }>(
        `SELECT conversation_id, read_receipts_enabled FROM chat.participants
          WHERE user_id = :userId AND conversation_id IN (:ab, :ac, :ad)`,
        { type: QueryTypes.SELECT, replacements: { userId: a.id, ab: ab.conversationId, ac: ac.conversationId, ad: ad.conversationId } },
      );
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ conversation_id: ab.conversationId, read_receipts_enabled: false }),
        expect.objectContaining({ conversation_id: ac.conversationId, read_receipts_enabled: false }),
        expect.objectContaining({ conversation_id: ad.conversationId, read_receipts_enabled: null }),
      ]));
      const [globalSettings] = await app.get(Sequelize).query<{ enabled: boolean; version: number; enabled_since: Date }>(
        `SELECT enabled, version, enabled_since FROM chat.read_receipt_settings WHERE user_id = :userId`,
        { type: QueryTypes.SELECT, replacements: { userId: a.id } },
      );
      expect(globalSettings).toMatchObject({ enabled: true, version: 1 });
      expect(new Date(globalSettings.enabled_since).toISOString()).toBe(originalEnabledSince.toISOString());
      expect(await app.get(ChatRepository).readReceiptPolicy(ad.conversationId)).toEqual(adPolicyBefore);
      expect(changedEvents.mock.calls).toEqual(expect.arrayContaining([
        [ab.conversationId, a.id, 1],
        [ac.conversationId, a.id, 1],
      ]));
      expect(changedEvents).toHaveBeenCalledTimes(2);
    } finally {
      changedEvents.mockRestore();
    }
  }, 60000);

  it("H7.S3.M3 resets conversation exceptions and sets the default for future chats", async () => {
    const a = await register("receipt-all-a");
    const b = await register("receipt-all-b");
    const c = await register("receipt-all-c");
    const d = await register("receipt-all-d");
    const e = await register("receipt-all-e");
    const ab = await connect(a, b);
    const ac = await connect(a, c);
    const ad = await connect(a, d);
    const settingsUrl = url("/me/chat/read-receipts");
    const settings = (conversationId?: string) => request(server).get(settingsUrl)
      .set("Authorization", `Bearer ${a.token}`)
      .query(conversationId ? { conversationId } : {});

    await request(server).put(settingsUrl).set("Authorization", `Bearer ${a.token}`).send({
      scope: "SELECTED", conversationIds: [ab.conversationId, ac.conversationId], enabled: false, expectedVersion: 0,
    }).expect(200);
    const changedEvents = jest.spyOn(app.get(ChatEventsService), "emitReadReceiptSettingsChanged");
    try {
      const updated = await request(server).put(settingsUrl).set("Authorization", `Bearer ${a.token}`).send({
        scope: "ALL", enabled: false, expectedVersion: 1,
      }).expect(200);
      expect(updated.body.data).toMatchObject({ enabled: false, defaultEnabled: false, conversationOverride: null, version: 2 });

      for (const conversationId of [ab.conversationId, ac.conversationId, ad.conversationId]) {
        expect(await settings(conversationId).expect(200).then((response) => response.body.data as ReadReceiptSettingsResponse))
          .toMatchObject({ enabled: false, defaultEnabled: false, conversationOverride: null, version: 2 });
      }
      const rows = await app.get(Sequelize).query<{ conversation_id: string; read_receipts_enabled: boolean | null }>(
        `SELECT conversation_id, read_receipts_enabled FROM chat.participants
          WHERE user_id = :userId AND conversation_id IN (:ab, :ac, :ad)`,
        { type: QueryTypes.SELECT, replacements: { userId: a.id, ab: ab.conversationId, ac: ac.conversationId, ad: ad.conversationId } },
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.read_receipts_enabled === null)).toBe(true);
      expect(changedEvents.mock.calls).toEqual(expect.arrayContaining([
        [ab.conversationId, a.id, 2],
        [ac.conversationId, a.id, 2],
        [ad.conversationId, a.id, 2],
      ]));
      expect(changedEvents).toHaveBeenCalledTimes(3);

      const ae = await connect(a, e);
      expect(await settings(ae.conversationId).expect(200).then((response) => response.body.data as ReadReceiptSettingsResponse))
        .toMatchObject({ enabled: false, defaultEnabled: false, conversationOverride: null, version: 2 });
    } finally {
      changedEvents.mockRestore();
    }
  }, 60000);

  it("H7.S3.M4 requires both participants to allow public read receipts", async () => {
    const a = await register("receipt-reciprocity-a");
    const b = await register("receipt-reciprocity-b");
    const { conversationId } = await connect(a, b);
    const settingsUrl = url("/me/chat/read-receipts");
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    await request(server).put(settingsUrl).set("Authorization", `Bearer ${a.token}`).send({
      scope: "ALL", enabled: true, expectedVersion: 0,
    }).expect(200);

    await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Mensaje de A", clientRequestId: "00000000-0000-4000-8000-000000000201" }).expect(201);
    await request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`)
      .send({ body: "Mensaje de B", clientRequestId: "00000000-0000-4000-8000-000000000202" }).expect(201);

    const readEvents = jest.spyOn(app.get(ChatEventsService), "emitRead");
    try {
      await request(server).post(url(`/me/conversations/${conversationId}/read`))
        .set("Authorization", `Bearer ${a.token}`).send({}).expect(201);
      const beforeOptOut = await request(server).get(url("/me/conversations"))
        .set("Authorization", `Bearer ${b.token}`).expect(200);
      const visibleBeforeOptOut = beforeOptOut.body.data.find((row: { conversationId: string }) => row.conversationId === conversationId);
      expect(visibleBeforeOptOut?.otherUserLastReadAt).toEqual(expect.any(String));
      expect(readEvents).toHaveBeenCalledTimes(1);

      await request(server).put(settingsUrl).set("Authorization", `Bearer ${b.token}`).send({
        scope: "CONVERSATION", conversationId, enabled: false, expectedVersion: 0,
      }).expect(200);
      readEvents.mockClear();
      await request(server).post(url(`/me/conversations/${conversationId}/read`))
        .set("Authorization", `Bearer ${a.token}`).send({}).expect(201);
      await request(server).post(url(`/me/conversations/${conversationId}/read`))
        .set("Authorization", `Bearer ${b.token}`).send({}).expect(201);

      expect(readEvents).not.toHaveBeenCalled();
      const participants = await app.get(Sequelize).query<{
        user_id: string;
        last_read_at: Date | null;
        last_delivered_at: Date | null;
        last_receipt_read_at: Date | null;
      }>(
        `SELECT user_id, last_read_at, last_delivered_at, last_receipt_read_at
           FROM chat.participants WHERE conversation_id = :conversationId`,
        { type: QueryTypes.SELECT, replacements: { conversationId } },
      );
      expect(participants).toHaveLength(2);
      expect(participants.every((participant) => participant.last_read_at !== null && participant.last_delivered_at !== null)).toBe(true);
      expect(participants.find((participant) => participant.user_id === a.id)?.last_receipt_read_at).toEqual(expect.any(Date));
      expect(participants.find((participant) => participant.user_id === b.id)?.last_receipt_read_at).toBeNull();

      for (const token of [a.token, b.token]) {
        const summaries = await request(server).get(url("/me/conversations"))
          .set("Authorization", `Bearer ${token}`).expect(200);
        expect(summaries.body.data).toEqual(expect.arrayContaining([
          expect.objectContaining({ conversationId, otherUserLastReadAt: null }),
        ]));
      }
    } finally {
      readEvents.mockRestore();
    }
  }, 60000);

  it("H7.S3.M5 publishes a read cutoff so enabling receipts cannot reveal an earlier read", async () => {
    const a = await register("receipt-cutoff-a");
    const b = await register("receipt-cutoff-b");
    const { conversationId } = await connect(a, b);
    const settingsUrl = url("/me/chat/read-receipts");
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const readUrl = url(`/me/conversations/${conversationId}/read`);
    for (const token of [a.token, b.token]) {
      await request(server).put(settingsUrl).set("Authorization", `Bearer ${token}`).send({
        scope: "ALL", enabled: false, expectedVersion: 0,
      }).expect(200);
    }

    const readEvents = jest.spyOn(app.get(ChatEventsService), "emitRead");
    try {
      const m1 = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
        .send({ body: "m1 leído con visto apagado", clientRequestId: "00000000-0000-4000-8000-000000000301" }).expect(201);
      await request(server).post(readUrl).set("Authorization", `Bearer ${b.token}`).send({}).expect(201);
      expect(readEvents).not.toHaveBeenCalled();

      for (const token of [a.token, b.token]) {
        await request(server).put(settingsUrl).set("Authorization", `Bearer ${token}`).send({
          scope: "ALL", enabled: true, expectedVersion: 1,
        }).expect(200);
      }
      const m2 = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
        .send({ body: "m2 leído con visto activo", clientRequestId: "00000000-0000-4000-8000-000000000302" }).expect(201);
      await request(server).post(readUrl).set("Authorization", `Bearer ${b.token}`).send({}).expect(201);

      expect(readEvents).toHaveBeenCalledTimes(1);
      const [, receipt] = readEvents.mock.calls[0];
      expect(receipt.userId).toBe(b.id);
      expect(receipt.readFrom).toEqual(expect.any(String));
      const summaries = await request(server).get(url("/me/conversations"))
        .set("Authorization", `Bearer ${a.token}`).expect(200);
      const summary = summaries.body.data.find((row: { conversationId: string }) => row.conversationId === conversationId);
      expect(summary?.otherUserLastReadAt).toEqual(expect.any(String));
      expect(summary?.otherUserReadReceiptsSinceAt).toBe(receipt.readFrom);

      const cutoff = new Date(receipt.readFrom as string).getTime();
      const lastReadAt = new Date(summary.otherUserLastReadAt as string).getTime();
      const eventReadAt = new Date(receipt.readAt).getTime();
      const m1CreatedAt = new Date(m1.body.data.createdAt as string).getTime();
      const m2CreatedAt = new Date(m2.body.data.createdAt as string).getTime();
      expect(m1CreatedAt).toBeLessThan(cutoff);
      expect(m2CreatedAt).toBeGreaterThanOrEqual(cutoff);
      expect(m2CreatedAt).toBeLessThanOrEqual(lastReadAt);
      expect(m2CreatedAt).toBeLessThanOrEqual(eventReadAt);
    } finally {
      readEvents.mockRestore();
    }
  }, 60000);

  it("H7.S3.M6 keeps delivery and internal read cursors working with receipts disabled", async () => {
    const a = await register("receipt-internal-a");
    const b = await register("receipt-internal-b");
    const { conversationId } = await connect(a, b);
    const settingsUrl = url("/me/chat/read-receipts");
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const readUrl = url(`/me/conversations/${conversationId}/read`);
    await request(server).put(settingsUrl).set("Authorization", `Bearer ${a.token}`).send({
      scope: "ALL", enabled: false, expectedVersion: 0,
    }).expect(200);
    const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Mensaje recibido con visto apagado", clientRequestId: "00000000-0000-4000-8000-000000000401" }).expect(201);
    const deliveredEvents = jest.spyOn(app.get(ChatEventsService), "emitDelivered");
    const readEvents = jest.spyOn(app.get(ChatEventsService), "emitRead");
    try {
      const history = await request(server).get(messagesUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
      expect(history.body.data).toHaveLength(1);
      expect(history.body.data[0].id).toBe(sent.body.data.id);
      expect(deliveredEvents.mock.calls).toEqual(expect.arrayContaining([
        [conversationId, expect.objectContaining({ userId: b.id, deliveredAt: expect.any(String) })],
      ]));
      let [participant] = await app.get(Sequelize).query<{
        last_read_at: Date | null;
        last_delivered_at: Date | null;
        last_receipt_read_at: Date | null;
      }>(
        `SELECT last_read_at, last_delivered_at, last_receipt_read_at
           FROM chat.participants WHERE conversation_id = :conversationId AND user_id = :userId`,
        { type: QueryTypes.SELECT, replacements: { conversationId, userId: b.id } },
      );
      expect(participant.last_read_at).toBeNull();
      expect(participant.last_delivered_at).toEqual(expect.any(Date));
      expect(participant.last_receipt_read_at).toBeNull();
      const deliveredBeforeRead = participant.last_delivered_at;
      if (!(deliveredBeforeRead instanceof Date)) throw new Error("Expected delivery cursor after loading history");

      await request(server).post(readUrl).set("Authorization", `Bearer ${b.token}`).send({}).expect(201);
      expect(readEvents).not.toHaveBeenCalled();
      [participant] = await app.get(Sequelize).query(
        `SELECT last_read_at, last_delivered_at, last_receipt_read_at
           FROM chat.participants WHERE conversation_id = :conversationId AND user_id = :userId`,
        { type: QueryTypes.SELECT, replacements: { conversationId, userId: b.id } },
      );
      expect(participant.last_read_at).toEqual(expect.any(Date));
      const readAt = participant.last_read_at;
      if (!(readAt instanceof Date)) throw new Error("Expected internal read cursor to be persisted");
      expect(readAt.getTime())
        .toBeGreaterThanOrEqual(new Date(sent.body.data.createdAt as string).getTime());
      expect(participant.last_delivered_at).toEqual(expect.any(Date));
      const deliveredAfterRead = participant.last_delivered_at;
      if (!(deliveredAfterRead instanceof Date)) throw new Error("Expected delivery cursor after marking read");
      expect(deliveredAfterRead.getTime()).toBeGreaterThanOrEqual(deliveredBeforeRead.getTime());
      expect(deliveredAfterRead.getTime()).toBe(readAt.getTime());
      expect(participant.last_receipt_read_at).toBeNull();
      const summary = await request(server).get(url("/me/conversations"))
        .set("Authorization", `Bearer ${a.token}`).expect(200);
      expect(summary.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          conversationId,
          otherUserLastDeliveredAt: expect.any(String),
          otherUserLastReadAt: null,
        }),
      ]));
    } finally {
      deliveredEvents.mockRestore();
      readEvents.mockRestore();
    }
  }, 60000);

  it("serializes read receipt publication with a concurrent opt-out", async () => {
    const a = await register("receipt-race-a");
    const b = await register("receipt-race-b");
    const { conversationId } = await connect(a, b);
    const chat = app.get(ChatService);
    const repository = app.get(ChatRepository);
    const events = app.get(ChatEventsService);
    const settings = app.get(ReadReceiptSettingsService);
    const sequelize = app.get(Sequelize);
    const policyRead = repository.readReceiptPolicy.bind(repository);
    let finishPolicy!: () => void;
    let announcePolicyRead!: () => void;
    const policyGate = new Promise<void>((resolve) => { finishPolicy = resolve; });
    const observedPolicyRead = new Promise<void>((resolve) => { announcePolicyRead = resolve; });
    let firstPolicyRead = true;
    const order: string[] = [];
    const readPolicySpy = jest.spyOn(repository, "readReceiptPolicy").mockImplementation(async (id) => {
      const policy = await policyRead(id);
      if (firstPolicyRead) {
        firstPolicyRead = false;
        announcePolicyRead();
        await policyGate;
      }
      return policy;
    });
    const readEvent = jest.spyOn(events, "emitRead").mockImplementation(() => { order.push("read"); });
    const settingsEvent = jest.spyOn(events, "emitReadReceiptSettingsChanged")
      .mockImplementation(() => { order.push("settings"); });
    const marking = chat.markRead(conversationId, a.id);

    try {
      await observedPolicyRead;

      // An independent transaction must fail NOWAIT while markRead is holding
      // the same per-user lock used by preference writes.
      let probeAcquiredUserLock = true;
      try {
        await sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE NOWAIT`,
            { type: QueryTypes.SELECT, replacements: { userId: a.id }, transaction },
          );
        });
      } catch (error) {
        const lockError = error as { original?: { code?: string } };
        if (lockError.original?.code === "55P03") probeAcquiredUserLock = false;
        else throw error;
      }
      const changingSettings = settings.update(a.id, {
        scope: "CONVERSATION", conversationId, enabled: false, expectedVersion: 0,
      });
      if (probeAcquiredUserLock) {
        // On the unfixed path the settings write can complete while markRead
        // is paused with a stale policy, making the invalid event order stable.
        await changingSettings;
        finishPolicy();
        await marking;
      } else {
        finishPolicy();
        await Promise.all([marking, changingSettings]);
      }

      expect(order).toEqual(["read", "settings"]);
      expect(probeAcquiredUserLock).toBe(false);
      expect(readEvent).toHaveBeenCalledTimes(1);
      expect(settingsEvent).toHaveBeenCalledTimes(1);
    } finally {
      finishPolicy();
      await marking;
      readPolicySpy.mockRestore();
      readEvent.mockRestore();
      settingsEvent.mockRestore();
    }
  }, 60000);

  it("locks both participants when the peer opts out during a pending read receipt", async () => {
    const a = await register("receipt-peer-race-reader");
    const b = await register("receipt-peer-race-peer");
    const { conversationId } = await connect(a, b);
    const chat = app.get(ChatService);
    const repository = app.get(ChatRepository);
    const events = app.get(ChatEventsService);
    const settings = app.get(ReadReceiptSettingsService);
    const sequelize = app.get(Sequelize);
    const policyRead = repository.readReceiptPolicy.bind(repository);
    let finishPolicy!: () => void;
    let announcePolicyRead!: () => void;
    const policyGate = new Promise<void>((resolve) => { finishPolicy = resolve; });
    const observedPolicyRead = new Promise<void>((resolve) => { announcePolicyRead = resolve; });
    let firstPolicyRead = true;
    const order: string[] = [];
    const readPolicySpy = jest.spyOn(repository, "readReceiptPolicy").mockImplementation(async (id) => {
      const policy = await policyRead(id);
      if (firstPolicyRead) {
        firstPolicyRead = false;
        announcePolicyRead();
        await policyGate;
      }
      return policy;
    });
    const readEvent = jest.spyOn(events, "emitRead").mockImplementation(() => { order.push("read"); });
    const settingsEvent = jest.spyOn(events, "emitReadReceiptSettingsChanged")
      .mockImplementation(() => { order.push("settings"); });
    const marking = chat.markRead(conversationId, a.id);

    try {
      await observedPolicyRead;

      let probeAcquiredPeerLock = true;
      try {
        await sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE NOWAIT`,
            { type: QueryTypes.SELECT, replacements: { userId: b.id }, transaction },
          );
        });
      } catch (error) {
        const lockError = error as { original?: { code?: string } };
        if (lockError.original?.code === "55P03") probeAcquiredPeerLock = false;
        else throw error;
      }

      const changingSettings = settings.update(b.id, {
        scope: "CONVERSATION", conversationId, enabled: false, expectedVersion: 0,
      });
      if (probeAcquiredPeerLock) {
        await changingSettings;
        finishPolicy();
        await marking;
      } else {
        finishPolicy();
        await Promise.all([marking, changingSettings]);
      }

      expect(order).toEqual(["read", "settings"]);
      expect(probeAcquiredPeerLock).toBe(false);
      expect(readEvent).toHaveBeenCalledTimes(1);
      expect(settingsEvent).toHaveBeenCalledWith(conversationId, b.id, 1);
    } finally {
      finishPolicy();
      await marking;
      readPolicySpy.mockRestore();
      readEvent.mockRestore();
      settingsEvent.mockRestore();
    }
  }, 60000);

  it("orders markRead locks consistently with social block before revocation", async () => {
    const a = await register("read-block-order-a");
    const b = await register("read-block-order-b");
    const { conversationId } = await connect(a, b);
    const sequelize = app.get(Sequelize);
    const repository = app.get(ChatRepository);
    let announceUserLockAttempt!: () => void;
    const observedUserLockAttempt = new Promise<void>((resolve) => { announceUserLockAttempt = resolve; });
    const lockParticipants = repository.lockReadReceiptParticipants.bind(repository);
    const readLockSpy = jest.spyOn(repository, "lockReadReceiptParticipants").mockImplementation(async (id, transaction) => {
      announceUserLockAttempt();
      return lockParticipants(id, transaction);
    });
    let blockAcquiredConversation = false;
    let marking!: Promise<{ read: true }>;
    const blockTransaction = sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `SELECT id FROM public.usuarios WHERE id IN (:userA, :userB) ORDER BY id FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { userA: a.id, userB: b.id }, transaction },
      );
      marking = app.get(ChatService).markRead(conversationId, a.id);
      await observedUserLockAttempt;
      try {
        await sequelize.query(
          `SELECT id FROM chat.conversations WHERE id = :conversationId FOR UPDATE NOWAIT`,
          { type: QueryTypes.SELECT, replacements: { conversationId }, transaction },
        );
        blockAcquiredConversation = true;
        await sequelize.query(
          `UPDATE chat.conversations SET revoked_at = NOW()
            WHERE id = :conversationId AND revoked_at IS NULL`,
          { replacements: { conversationId }, transaction },
        );
      } catch (error) {
        const lockError = error as { original?: { code?: string } };
        if (lockError.original?.code !== "55P03") throw error;
      }
    });

    try {
      await blockTransaction;
      if (blockAcquiredConversation) {
        await expect(marking).rejects.toThrow("Conversación no encontrada.");
      } else {
        await expect(marking).resolves.toEqual({ read: true });
      }
      expect(blockAcquiredConversation).toBe(true);
    } finally {
      readLockSpy.mockRestore();
    }
  }, 60000);

  it("serializes direct conversation creation with blocking so no active orphan chat remains", async () => {
    const a = await register("create-block-race-a");
    const b = await register("create-block-race-b");
    const connected = await request(server).post(url("/me/connections"))
      .set("Authorization", `Bearer ${a.token}`).send({ addresseeId: b.id }).expect(201);
    await request(server).patch(url(`/me/connections/${connected.body.data.id}`))
      .set("Authorization", `Bearer ${b.token}`).send({ action: "ACCEPT" }).expect(200);

    const sequelize = app.get(Sequelize);
    const repository = app.get(ChatRepository);
    // Aceptar ya crea el chat; aquí se quiere la carrera de crearlo después
    // (conexiones aceptadas antes de eso, sin chat), así que se borra.
    const autoCreated = await repository.findDirectConversation(a.id, b.id);
    if (autoCreated) {
      await sequelize.query(`DELETE FROM chat.conversations WHERE id = :id`, { replacements: { id: autoCreated } });
    }
    const socialRepository = app.get(SocialRepository);
    const chat = app.get(ChatService);
    const conversationModel = app.get<typeof ConversationModel>(getModelToken(ConversationModel));
    let finishCreate!: () => void;
    let announceCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { finishCreate = resolve; });
    const observedCreate = new Promise<void>((resolve) => { announceCreate = resolve; });
    const createConversation = conversationModel.create.bind(conversationModel);
    const createSpy = jest.spyOn(conversationModel, "create").mockImplementation(async (...args) => {
      announceCreate();
      await createGate;
      return createConversation(...args);
    });
    const creating = chat.getOrStartConversation(a.id, env.DEFAULT_TENANT_ID, b.id);
    const creationOutcome = creating.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let announcePairLockEntry!: () => void;
    let announcePairLockComplete!: () => void;
    const observedPairLockEntry = new Promise<void>((resolve) => { announcePairLockEntry = resolve; });
    const observedPairLockComplete = new Promise<void>((resolve) => { announcePairLockComplete = resolve; });
    let blockSpy: jest.SpyInstance | undefined;
    let blockingOutcome: Promise<{ value: string[] } | { error: unknown }> | undefined;
    try {
      await observedCreate;
      const originalLockSocialPair = socialRepository.lockSocialPair.bind(socialRepository);
      blockSpy = jest.spyOn(socialRepository, "lockSocialPair").mockImplementation(async (...args) => {
        announcePairLockEntry();
        await originalLockSocialPair(...args);
        announcePairLockComplete();
      });
      const blocking = socialRepository.blockUser(a.id, b.id);
      blockingOutcome = blocking.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await observedPairLockEntry;

      // The creator is paused while holding the pair locks. The blocker must
      // enter lockSocialPair but stay there until creation commits.
      let userLockProbeAcquired = true;
      try {
        await sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM public.usuarios WHERE id IN (:userA, :userB) ORDER BY id FOR UPDATE NOWAIT`,
            { type: QueryTypes.SELECT, replacements: { userA: a.id, userB: b.id }, transaction },
          );
        });
      } catch (error) {
        const lockError = error as { original?: { code?: string } };
        if (lockError.original?.code === "55P03") userLockProbeAcquired = false;
        else throw error;
      }
      const completedWhileCreatePaused = await Promise.race([
        observedPairLockComplete.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(userLockProbeAcquired).toBe(false);
      expect(completedWhileCreatePaused).toBe(false);

      finishCreate();
      const createResult = await creationOutcome;
      if ("error" in createResult) throw createResult.error;
      const conversationId = createResult.value;
      const blockResult = await blockingOutcome;
      if ("error" in blockResult) throw blockResult.error;
      expect(blockResult.value).toContain(conversationId);

      const rows = await sequelize.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM chat.conversations WHERE id = :conversationId`,
        { type: QueryTypes.SELECT, replacements: { conversationId } },
      );
      const active = await repository.findDirectConversation(a.id, b.id);
      expect(rows[0]?.revoked_at).not.toBeNull();
      expect(active).toBeNull();
    } finally {
      finishCreate();
      await Promise.all([creationOutcome, ...(blockingOutcome ? [blockingOutcome] : [])]);
      createSpy.mockRestore();
      blockSpy?.mockRestore();
    }
  }, 60000);

  it("H7.S4.M5 hides revoked chat history and media from both former participants", async () => {
    const a = await register("revoked-chat-a");
    const b = await register("revoked-chat-b");
    const { connectionId, conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Mensaje antes de desconectar", clientRequestId: randomUUID() }).expect(201);
    const media = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${b.token}`)
      .field("type", "image")
      .attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
        filename: "revoked-chat.jpg", contentType: "image/jpeg",
      }).expect(201);
    const mediaUrl = url(media.body.data.mediaUrl as string);
    const revokedEvents = jest.spyOn(app.get(ChatEventsService), "emitConversationRevoked");

    try {
      for (const token of [a.token, b.token]) {
        const history = await request(server).get(messagesUrl).set("Authorization", `Bearer ${token}`).expect(200);
        expect(history.body.data).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: sent.body.data.id, body: "Mensaje antes de desconectar" }),
          expect.objectContaining({ id: media.body.data.id, type: "image" }),
        ]));
        await request(server).get(mediaUrl).set("Authorization", `Bearer ${token}`).expect(200);
      }

      await request(server).delete(url(`/me/connections/${connectionId}`))
        .set("Authorization", `Bearer ${a.token}`).expect(200);
      expect(revokedEvents).toHaveBeenCalledWith(conversationId, a.id);

      for (const token of [a.token, b.token]) {
        const summaries = await request(server).get(url("/me/conversations"))
          .set("Authorization", `Bearer ${token}`).expect(200);
        expect(summaries.body.data).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ conversationId }),
        ]));
        await request(server).get(messagesUrl).set("Authorization", `Bearer ${token}`).expect(404);
        await request(server).get(mediaUrl).set("Authorization", `Bearer ${token}`).expect(404);
      }
    } finally {
      revokedEvents.mockRestore();
    }
  }, 60000);

  it("serializes markRead with connection revocation", async () => {
    const a = await register("revoked-read-race-a");
    const b = await register("revoked-read-race-b");
    const { conversationId } = await connect(a, b);
    const chat = app.get(ChatService);
    const repository = app.get(ChatRepository);
    const events = app.get(ChatEventsService);
    const sequelize = app.get(Sequelize);
    const policyRead = repository.readReceiptPolicy.bind(repository);
    let finishPolicy!: () => void;
    let announcePolicyRead!: () => void;
    const policyGate = new Promise<void>((resolve) => { finishPolicy = resolve; });
    const observedPolicyRead = new Promise<void>((resolve) => { announcePolicyRead = resolve; });
    let firstPolicyRead = true;
    const order: string[] = [];
    const readPolicySpy = jest.spyOn(repository, "readReceiptPolicy").mockImplementation(async (id, transaction) => {
      const policy = await policyRead(id, transaction);
      if (firstPolicyRead) {
        firstPolicyRead = false;
        announcePolicyRead();
        await policyGate;
      }
      return policy;
    });
    const readEvent = jest.spyOn(events, "emitRead").mockImplementation(() => { order.push("read"); });
    const revokedEvent = jest.spyOn(events, "emitConversationRevoked")
      .mockImplementation(() => { order.push("revoked"); });
    const marking = chat.markRead(conversationId, a.id);

    try {
      await observedPolicyRead;
      let probeAcquiredConversationLock = true;
      try {
        await sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM chat.conversations WHERE id = :conversationId FOR UPDATE NOWAIT`,
            { type: QueryTypes.SELECT, replacements: { conversationId }, transaction },
          );
        });
      } catch (error) {
        const lockError = error as { original?: { code?: string } };
        if (lockError.original?.code === "55P03") probeAcquiredConversationLock = false;
        else throw error;
      }

      const revoking = sequelize.query(
        `UPDATE chat.conversations SET revoked_at = NOW()
          WHERE id = :conversationId AND revoked_at IS NULL`,
        { replacements: { conversationId } },
      ).then(() => events.emitConversationRevoked(conversationId, a.id));
      if (probeAcquiredConversationLock) {
        await revoking;
        finishPolicy();
        await marking;
      } else {
        finishPolicy();
        await Promise.all([marking, revoking]);
      }

      expect(order).toEqual(["read", "revoked"]);
      expect(probeAcquiredConversationLock).toBe(false);
      expect(revokedEvent).toHaveBeenCalledWith(conversationId, a.id);
    } finally {
      finishPolicy();
      await marking;
      readPolicySpy.mockRestore();
      readEvent.mockRestore();
      revokedEvent.mockRestore();
    }
  }, 60000);

  it("serializes conversation:join with connection revocation", async () => {
    const a = await register("revoked-join-race-a");
    const b = await register("revoked-join-race-b");
    const { connectionId, conversationId } = await connect(a, b);
    const gateway = app.get(ChatGateway);
    const events = app.get(ChatEventsService);
    const sequelize = app.get(Sequelize);
    let finishJoin!: () => void;
    let announceJoin!: () => void;
    const joinGate = new Promise<void>((resolve) => { finishJoin = resolve; });
    const observedJoin = new Promise<void>((resolve) => { announceJoin = resolve; });
    const order: string[] = [];
    const client = {
      data: { userId: a.id },
      join: jest.fn(async () => {
        order.push("join-start");
        announceJoin();
        await joinGate;
        order.push("join-complete");
      }),
      leave: jest.fn().mockResolvedValue(undefined),
    };
    const revokedEvent = jest.spyOn(events, "emitConversationRevoked")
      .mockImplementation(() => { order.push("revoked"); });
    const joining = gateway.joinConversation(client as never, { conversationId });

    try {
      await observedJoin;
      let probeAcquiredConversationLock = true;
      try {
        await sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM chat.conversations WHERE id = :conversationId FOR UPDATE NOWAIT`,
            { type: QueryTypes.SELECT, replacements: { conversationId }, transaction },
          );
        });
      } catch (error) {
        const lockError = error as { original?: { code?: string } };
        if (lockError.original?.code === "55P03") probeAcquiredConversationLock = false;
        else throw error;
      }

      const revoking = request(server).delete(url(`/me/connections/${connectionId}`))
        .set("Authorization", `Bearer ${a.token}`).expect(200);
      if (probeAcquiredConversationLock) {
        await revoking;
        finishJoin();
        await joining;
      } else {
        finishJoin();
        await Promise.all([joining, revoking]);
      }

      await expect(joining).resolves.toEqual({ joined: true });
      expect(order.indexOf("join-complete")).toBeLessThan(order.indexOf("revoked"));
      expect(probeAcquiredConversationLock).toBe(false);
      expect(revokedEvent).toHaveBeenCalledWith(conversationId, a.id);
    } finally {
      finishJoin();
      await joining;
      revokedEvent.mockRestore();
    }
  }, 60000);

  it("H7.S2.M2 rejects B editing A's known message ID with 404 and preserves its content", async () => {
    const a = await register("owner-a");
    const b = await register("nonowner-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Texto privado de A", clientRequestId: "00000000-0000-4000-8000-000000000073" }).expect(201);
    const knownHistory = await request(server).get(messagesUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(knownHistory.body.data).toEqual([sent.body.data]);
    const knownId = knownHistory.body.data[0].id as string;
    const before = (await MessageModel.findByPk(knownId))?.toJSON();
    const updates = jest.spyOn(app.get(ChatEventsService), "emitMessageUpdated");
    try {
      const rejected = await request(server).patch(`${messagesUrl}/${knownId}`)
        .set("Authorization", `Bearer ${b.token}`).send({ body: "Texto reemplazado por B" }).expect(404);
      expect(JSON.stringify(rejected.body)).not.toContain("Texto privado de A");
      expect((await MessageModel.findByPk(knownId))?.toJSON()).toEqual(before);
      expect(await MessageModel.count({ where: { conversationId } })).toBe(1);
      expect(updates).not.toHaveBeenCalled();
      for (const token of [a.token, b.token]) {
        const reloaded = await request(server).get(messagesUrl).set("Authorization", `Bearer ${token}`).expect(200);
        expect(reloaded.body.data).toEqual([sent.body.data]);
      }
    } finally {
      updates.mockRestore();
    }
  }, 60000);

  it("H7.S2.M3 deletes only for A, keeps B's message intact, and persists across reload and app restart", async () => {
    const a = await register("local-delete-a");
    const b = await register("local-delete-b");
    const outsider = await register("local-delete-outsider");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const older = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Mensaje anterior visible", clientRequestId: "00000000-0000-4000-8000-000000000083" }).expect(201);
    await MessageModel.update({ createdAt: new Date(Date.now() - 10000) }, { where: { id: older.body.data.id } });
    const target = await request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`)
      .send({ body: "Mensaje de B que A oculta" }).expect(201);
    const messageId = target.body.data.id as string;
    const original = (await MessageModel.findByPk(messageId))?.toJSON();
    const history = (token: string) => request(server).get(`${messagesUrl}?limit=1`).set("Authorization", `Bearer ${token}`);
    for (const token of [a.token, b.token]) expect((await history(token).expect(200)).body.data).toEqual([target.body.data]);
    const remove = (token = a.token) => request(server).delete(`${messagesUrl}/${messageId}?scope=ME`)
      .set("Authorization", `Bearer ${token}`);
    await remove().expect(200);
    await Promise.all([remove().expect(200), remove().expect(200)]);
    await remove(outsider.token).expect(404);
    await request(server).delete(`${messagesUrl}/00000000-0000-4000-8000-000000000099?scope=ME`)
      .set("Authorization", `Bearer ${a.token}`).expect(404);
    await request(server).delete(`${messagesUrl}/${messageId}?scope=INVALID`)
      .set("Authorization", `Bearer ${a.token}`).expect(400);
    await request(server).delete(`${messagesUrl}/${messageId}?scope=ME&userId=${b.id}`)
      .set("Authorization", `Bearer ${a.token}`).expect(400);
    const visibleA = await history(a.token).expect(200);
    expect(visibleA.body.data).toEqual([expect.objectContaining({ id: older.body.data.id, body: "Mensaje anterior visible" })]);
    expect((await history(b.token).expect(200)).body.data).toEqual([target.body.data]);
    expect((await MessageModel.findByPk(messageId))?.toJSON()).toEqual(original);
    expect(await MessageModel.count({ where: { conversationId } })).toBe(2);
    const markers = await app.get(Sequelize).query<{ user_id: string }>(
      "SELECT user_id FROM chat.message_visibility WHERE message_id = :messageId",
      { type: QueryTypes.SELECT, replacements: { messageId } },
    );
    expect(markers).toEqual([{ user_id: a.id }]);
    await app.close();
    await createApp();
    expect((await history(a.token).expect(200)).body.data).toEqual(visibleA.body.data);
    expect((await history(b.token).expect(200)).body.data).toEqual([target.body.data]);
    for (const [token, expected] of [[a.token, "Mensaje anterior visible"], [b.token, "Mensaje de B que A oculta"]]) {
      const summaries = await request(server).get(url("/me/conversations")).set("Authorization", `Bearer ${token}`).expect(200);
      expect(summaries.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ conversationId, lastMessage: expected })]));
    }
    await request(server).delete(`${messagesUrl}/${older.body.data.id}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(200);
    await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Mensaje anterior visible", clientRequestId: "00000000-0000-4000-8000-000000000083" }).expect(404);
    await request(server).patch(`${messagesUrl}/${older.body.data.id}`).set("Authorization", `Bearer ${a.token}`)
      .send({ body: "Editar mensaje oculto" }).expect(404);
    expect((await history(a.token).expect(200)).body.data).toEqual([]);
    expect(await MessageModel.count({ where: { conversationId } })).toBe(2);
  }, 60000);

  it("H7.S2.M3 denies hidden media only to A while B can download it", async () => {
    const a = await register("hidden-media-a");
    const b = await register("hidden-media-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${b.token}`)
      .field("type", "image").attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
        filename: "local-hide.jpg", contentType: "image/jpeg",
      }).expect(201);
    const mediaUrl = `${messagesUrl}/${sent.body.data.id}/media`;
    const before = await request(server).get(mediaUrl).set("Authorization", `Bearer ${a.token}`).expect(200);
    await request(server).delete(`${messagesUrl}/${sent.body.data.id}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(200);
    await request(server).get(mediaUrl).set("Authorization", `Bearer ${a.token}`).expect(404);
    const visibleB = await request(server).get(mediaUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(visibleB.body).toEqual(before.body);
    const viewOnce = await request(server).post(`${messagesUrl}/media`).set("Authorization", `Bearer ${b.token}`)
      .field("type", "image").field("viewOnce", "true")
      .attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
        filename: "hidden-view-once.jpg", contentType: "image/jpeg",
      }).expect(201);
    await request(server).delete(`${messagesUrl}/${viewOnce.body.data.id}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(200);
    await request(server).post(`${messagesUrl}/${viewOnce.body.data.id}/view`).set("Authorization", `Bearer ${a.token}`).expect(404);
    expect((await MessageModel.findByPk(viewOnce.body.data.id))?.viewedAt).toBeNull();
    await request(server).post(url("/me/blocks")).set("Authorization", `Bearer ${b.token}`).send({ targetUserId: a.id }).expect(201);
    await request(server).delete(`${messagesUrl}/${sent.body.data.id}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(404);
  }, 60000);

  it("H7.S2.M3 suppresses shared edit events after A hides B's text and keeps A's history hidden", async () => {
    const a = await register("hidden-event-a");
    const b = await register("hidden-event-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`)
      .send({ body: "Texto original de B" }).expect(201);
    const messageId = sent.body.data.id as string;
    const updates = jest.spyOn(app.get(ChatEventsService), "emitMessageUpdated");
    const edit = (body: string) => request(server).patch(`${messagesUrl}/${messageId}`)
      .set("Authorization", `Bearer ${b.token}`).send({ body });
    try {
      const visibleEdit = await edit("Texto editado visible a ambos").expect(200);
      expect(updates).toHaveBeenCalledTimes(1);
      expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ id: messageId, body: visibleEdit.body.data.body }));
      await request(server).delete(`${messagesUrl}/${messageId}?scope=ME`).set("Authorization", `Bearer ${a.token}`).expect(200);
      const hiddenEdit = await edit("Texto nuevo que A no debe recibir").expect(200);
      expect(updates).toHaveBeenCalledTimes(1);
      const forA = await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200);
      const forB = await request(server).get(messagesUrl).set("Authorization", `Bearer ${b.token}`).expect(200);
      expect(forA.body.data).toEqual([]);
      expect(forB.body.data).toEqual([hiddenEdit.body.data]);
      expect((await MessageModel.findByPk(messageId))?.body).toBe("Texto nuevo que A no debe recibir");
    } finally {
      updates.mockRestore();
    }
  }, 60000);

  it("H7.S2.M3 serializes hide confirmation with shared edit publication", async () => {
    const a = await register("raced-hide-a");
    const b = await register("raced-edit-b");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${b.token}`)
      .send({ body: "Texto antes de la carrera" }).expect(201);
    const messageId = sent.body.data.id as string;
    const visibility = app.get<typeof MessageVisibilityModel>(getModelToken(MessageVisibilityModel));
    const originalFind = visibility.findOne.bind(visibility);
    let signalCheck!: () => void;
    let releaseCheck!: () => void;
    const paused = new Promise<void>(resolve => { signalCheck = resolve; });
    const resume = new Promise<void>(resolve => { releaseCheck = resolve; });
    const lookup = jest.spyOn(visibility, "findOne").mockImplementation(async options => {
      const result = await originalFind(options);
      const where = options?.where as { messageId?: string; userId?: string } | undefined;
      if (where?.messageId === messageId && !where.userId) {
        signalCheck();
        await resume;
      }
      return result;
    });
    let hideConfirmed = false;
    const publicationsAfterHide: boolean[] = [];
    const events = app.get(ChatEventsService);
    const originalEmit = events.emitMessageUpdated.bind(events);
    const publication = jest.spyOn(events, "emitMessageUpdated").mockImplementation(message => {
      publicationsAfterHide.push(hideConfirmed);
      originalEmit(message);
    });
    let editing: Promise<request.Response> | undefined;
    let hiding: Promise<request.Response> | undefined;
    try {
      editing = request(server).patch(`${messagesUrl}/${messageId}`).set("Authorization", `Bearer ${b.token}`)
        .send({ body: "Texto editado durante la carrera" }).then(response => response);
      await paused;
      hiding = request(server).delete(`${messagesUrl}/${messageId}?scope=ME`).set("Authorization", `Bearer ${a.token}`)
        .then(response => { hideConfirmed = response.status === 200; return response; });
      // Release when the hide either committed (old unsafe path) or is truly
      // waiting on the publication's conversation lock. No guessed sleep ordering.
      const deadline = Date.now() + 5000;
      let hideWaiting = false;
      while (!hideConfirmed && !hideWaiting && Date.now() < deadline) {
        const rows = await app.get(Sequelize).query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE :pattern) AS blocked",
          { type: QueryTypes.SELECT, replacements: { pattern: `%${conversationId}%` } },
        );
        hideWaiting = rows[0]?.blocked === true;
        if (!hideConfirmed && !hideWaiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(hideConfirmed || hideWaiting).toBe(true);
      releaseCheck();
      expect((await editing).status).toBe(200);
      expect((await hiding).status).toBe(200);
      expect(publicationsAfterHide).not.toContain(true);
      expect((await request(server).get(messagesUrl).set("Authorization", `Bearer ${a.token}`).expect(200)).body.data).toEqual([]);
    } finally {
      releaseCheck();
      await Promise.allSettled([editing, hiding].filter((promise): promise is Promise<request.Response> => promise !== undefined));
      lookup.mockRestore();
      publication.mockRestore();
    }
  }, 60000);

  it("H7.S1.M4 serves uploaded photos without embedded GPS EXIF to an authenticated participant", async () => {
    const photo = readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg"));
    const sourceMetadata = await sharp(photo).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif?.readUInt16LE(28)).toBe(0x8825);

    const a = await register("photo-sender");
    const b = await register("photo-recipient");
    const { conversationId } = await connect(a, b);
    const sent = await request(server).post(url(`/me/conversations/${conversationId}/messages/media`))
      .set("Authorization", `Bearer ${a.token}`)
      .field("type", "image")
      .attach("file", photo, { filename: "gps-orientation.jpg", contentType: "image/jpeg" })
      .expect(201);
    expect(await readdir(isolatedMediaRoot as string)).toContain("users");
    const mediaUrl = url(`/me/conversations/${conversationId}/messages/${sent.body.data.id}/media`);

    await request(server).get(mediaUrl).expect(401);
    const downloaded = await request(server).get(mediaUrl)
      .set("Authorization", `Bearer ${b.token}`).expect(200);
    expect(downloaded.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(Buffer.isBuffer(downloaded.body)).toBe(true);
    const served = downloaded.body as Buffer;
    const metadata = await sharp(served).metadata();
    expect(metadata).toEqual(expect.objectContaining({ format: "jpeg", width: 1, height: 2 }));
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(served.includes(Buffer.from("Exif\0\0"))).toBe(false);
  }, 60000);

  it("H7.S1.M5 rejects queued text and a photo after a block without persisting or emitting", async () => {
    const a = await register("queued-sender");
    const b = await register("blocking-recipient");
    const { conversationId } = await connect(a, b);
    const pending = {
      body: "Mensaje en cola antes del bloqueo",
      clientRequestId: "00000000-0000-4000-8000-000000000050",
    };
    const messageCountBefore = await MessageModel.count({ where: { conversationId } });
    const storedEntriesBefore = (await readdir(isolatedMediaRoot as string, { recursive: true })).sort();
    expect(messageCountBefore).toBe(0);

    await request(server).post(url("/me/blocks"))
      .set("Authorization", `Bearer ${b.token}`)
      .send({ targetUserId: a.id }).expect(201);

    const emitMessage = jest.spyOn(app.get(ChatEventsService), "emitMessage");
    try {
      const textRetry = await request(server).post(url(`/me/conversations/${conversationId}/messages`))
        .set("Authorization", `Bearer ${a.token}`).send(pending);
      const photoRetry = await request(server).post(url(`/me/conversations/${conversationId}/messages/media`))
        .set("Authorization", `Bearer ${a.token}`)
        .field("type", "image")
        .attach("file", readFileSync(join(__dirname, "../../src/modules/chat/fixtures/gps-orientation.jpg")), {
          filename: "queued-photo.jpg", contentType: "image/jpeg",
        });

      expect([403, 404]).toContain(textRetry.status);
      expect([403, 404]).toContain(photoRetry.status);
      expect(await MessageModel.count({ where: { conversationId } })).toBe(0);
      expect((await readdir(isolatedMediaRoot as string, { recursive: true })).sort()).toEqual(storedEntriesBefore);
      expect(emitMessage).not.toHaveBeenCalled();
    } finally {
      emitMessage.mockRestore();
    }
  }, 60000);
  it("H7.S2.M4 accepts 59:59:59 and 60:00:00, rejects 60:00:00.001 and 60:00:01 with original content intact (WhatsApp window)", async () => {
    // This case uses a fresh real app to keep fixture registrations inside normal auth limits.
    await app.close();
    await createApp();
    const a = await register("global-author");
    const b = await register("global-peer");
    const outsider = await register("global-outsider");
    const { conversationId } = await connect(a, b);
    const messagesUrl = url(`/me/conversations/${conversationId}/messages`);
    const base = Date.now();
    const createdAt = new Date(base - 216000000);
    const cases: Array<{ age: number; status: number; id: string; body: string; requestId: string }> = [];
    for (const [index, [age, status]] of [[215999000, 200], [216000000, 200], [216000001, 400], [216001000, 400]].entries()) {
      const body = `Texto privado original ${index}`;
      const requestId = `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
      const sent = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
        .send({ body, clientRequestId: requestId }).expect(201);
      await MessageModel.update({ createdAt }, { where: { id: sent.body.data.id } });
      cases.push({ age, status, id: sent.body.data.id as string, body, requestId });
    }
    for (const token of [b.token, outsider.token]) {
      await request(server).delete(`${messagesUrl}/${cases[0].id}?scope=EVERYONE`).set("Authorization", `Bearer ${token}`).expect(404);
    }
    await request(server).delete(`${messagesUrl}/${cases[0].id}?scope=EVERYONE&serverNow=${createdAt.toISOString()}`)
      .set("Authorization", `Bearer ${a.token}`).expect(400);
    const clock = jest.spyOn(Date, "now");
    try {
      for (const item of cases) {
        clock.mockReturnValue(createdAt.getTime() + item.age);
        const before = (await MessageModel.findByPk(item.id))?.toJSON();
        const response = await request(server).delete(`${messagesUrl}/${item.id}?scope=EVERYONE`)
          .set("Authorization", `Bearer ${a.token}`).expect(item.status);
        if (item.status === 200) {
          expect(response.body.data).toEqual(expect.objectContaining({
            id: item.id, body: "Mensaje eliminado", type: "text", createdAt: createdAt.toISOString(),
            deletedAt: new Date(createdAt.getTime() + item.age).toISOString(), editedAt: null,
            mediaUrl: null, mediaMimeType: null, stickerId: null, locationLat: null, locationLng: null,
            viewOnce: false, viewed: false,
          }));
          expect(JSON.stringify(response.body.data)).not.toContain(item.body);
          const row = await MessageModel.findByPk(item.id);
          expect(row?.body).toBeNull();
          expect(row?.idempotencyBody).toBeNull();
          expect(row?.get("deletedRequestHash")).toEqual(expect.stringMatching(/^v1:[0-9a-f]{64}$/));
        } else {
          expect((await MessageModel.findByPk(item.id))?.toJSON()).toEqual(before);
        }
      }
      clock.mockReturnValue(base + 1000);
      const repeated = await request(server).delete(`${messagesUrl}/${cases[0].id}?scope=EVERYONE`)
        .set("Authorization", `Bearer ${a.token}`).expect(200);
      expect(repeated.body.data.deletedAt).toBe(new Date(base - 1000).toISOString());
      const replay = await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
        .send({ body: cases[0].body, clientRequestId: cases[0].requestId }).expect(201);
      expect(replay.body.data).toEqual(expect.objectContaining({ id: cases[0].id, body: "Mensaje eliminado" }));
      await request(server).post(messagesUrl).set("Authorization", `Bearer ${a.token}`)
        .send({ body: "payload cambiado", clientRequestId: cases[0].requestId }).expect(409);
      for (const token of [a.token, b.token]) {
        const history = await request(server).get(messagesUrl).set("Authorization", `Bearer ${token}`).expect(200);
        for (const item of cases) {
          expect(history.body.data).toEqual(expect.arrayContaining([expect.objectContaining({
            id: item.id, body: item.status === 200 ? "Mensaje eliminado" : item.body,
          })]));
        }
      }
      expect(await MessageModel.count({ where: { conversationId } })).toBe(4);
    } finally {
      clock.mockRestore();
    }
  }, 60000);

});
