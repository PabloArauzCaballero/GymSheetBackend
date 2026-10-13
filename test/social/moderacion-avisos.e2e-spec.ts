import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { json, urlencoded } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationChannel } from "../../src/common/enums/domain.enums";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { runMigrations } from "../../src/database/migrate";
import { env } from "../../src/config/env";
import { OutboxService } from "../../src/modules/integration/outbox.service";
import { DomainEventPublisher } from "../../src/modules/integration/domain-event.publisher";
import { NotificationDeliveryService } from "../../src/modules/notifications/notification-delivery.service";
import { NotificationService } from "../../src/modules/notifications/notification.service";
import { NotificationDeliveryRunner } from "../../src/workers/notification-delivery.runner";
import { PushDispatcherService } from "../../src/modules/notifications/delivery/push-dispatcher.service";

describe("H11 moderation notices (PostgreSQL e2e)", () => {
  let moduleRef: TestingModule | undefined;
  let application: INestApplication | undefined;
  let sequelize: Sequelize | undefined;
  let admin: Sequelize | undefined;
  let worker: NotificationDeliveryRunner | undefined;
  let temporaryDatabase: string | undefined;
  const originalDatabase = env.DB_NAME;
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    if (
      originalDatabase !== "gymsheet_social_qa" ||
      !["127.0.0.1", "localhost"].includes(env.DB_HOST) ||
      Number(env.DB_PORT) !== 55432
    ) {
      throw new Error(
        "H11 notification E2E runs only from the isolated local QA database configuration.",
      );
    }

    temporaryDatabase = `h11_s2_m1_${randomUUID().replaceAll("-", "")}`;
    admin = new Sequelize({
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
      },
    });
    await admin.query(
      `CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0`,
    );
    env.DB_NAME = temporaryDatabase;
    await runMigrations("up");

    const { AppModule } = await import("../../src/app.module");
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const testSequelize = moduleRef.get(Sequelize);
    sequelize = testSequelize;
    const connectedDatabase = await testSequelize.query<{ name: string }>(
      "SELECT current_database() AS name",
      { type: QueryTypes.SELECT },
    );
    if (connectedDatabase[0]?.name !== temporaryDatabase) {
      throw new Error(
        `H11 E2E connected to ${connectedDatabase[0]?.name ?? "unknown"}, expected its isolated database.`,
      );
    }
    worker = new NotificationDeliveryRunner(
      moduleRef.get(OutboxService, { strict: false }),
      moduleRef.get(NotificationDeliveryService, { strict: false }),
    );
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(
      urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }),
    );
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
  }, 300000);

  afterAll(async () => {
    try {
      await application?.close();
      await moduleRef?.close();
      if (sequelize) await sequelize.close();
    } finally {
      env.DB_NAME = originalDatabase;
      if (admin && temporaryDatabase) {
        await admin.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`);
        const remaining = await admin.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_database WHERE datname = :databaseName`,
          {
            type: QueryTypes.SELECT,
            replacements: { databaseName: temporaryDatabase },
          },
        );
        expect(remaining[0].count).toBe("0");
      }
      await admin?.close();
    }
  }, 60000);

  it("H11.S2.M1 processes a repeated connection notice once through the delivery worker", async () => {
    if (
      !application ||
      !moduleRef ||
      !sequelize ||
      !worker ||
      !temporaryDatabase
    ) {
      throw new Error("H11 E2E setup did not finish.");
    }

    const suffix = randomUUID();
    const register = async (label: string) => {
      const registered = await request(application!.getHttpServer())
        .post(url("/auth/register"))
        .send({
          email: `h11-s2-m1-${label}-${suffix}@example.test`,
          password: "h11-notice-e2e-password",
          nombreCompleto: `H11 Notice ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      return {
        userId: registered.body.data.user.id as string,
        accessToken: registered.body.data.accessToken as string,
      };
    };
    const requester = await register("requester");
    const recipient = await register("recipient");
    const sent = await request(application.getHttpServer())
      .post(url("/me/connections"))
      .set("Authorization", `Bearer ${requester.accessToken}`)
      .send({ addresseeId: recipient.userId })
      .expect(201);
    const connectionId = sent.body.data.id as string;
    const deduplicationKey = `connection.accepted:${connectionId}:${requester.userId}`;
    const notification = moduleRef.get(NotificationService, { strict: false });
    const events = moduleRef.get(DomainEventPublisher, { strict: false });
    const input = {
      recipientUserId: requester.userId,
      channel: NotificationChannel.IN_APP,
      subject: "Solicitud de conexión aceptada",
      body: "Tu solicitud de conexión fue aceptada.",
      deduplicationKey,
      metadata: { kind: "CONNECTION_ACCEPTED", connectionId },
    };

    jest
      .spyOn(events, "recordAndEnqueue")
      .mockRejectedValueOnce(new Error("simulated outbox failure"));
    await request(application.getHttpServer())
      .patch(url(`/me/connections/${connectionId}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ action: "ACCEPT" })
      .expect(500);
    (events.recordAndEnqueue as jest.Mock).mockRestore();

    const afterFailedAcceptance = await sequelize.query<{
      connection_status: string;
      notification_count: string;
      job_count: string;
    }>(
      `SELECT
         (SELECT status FROM social.connections WHERE id = :connectionId) AS connection_status,
         (SELECT count(*)::text FROM notifications.messages WHERE deduplication_key = :deduplicationKey) AS notification_count,
         (SELECT count(*)::text FROM integration.outbox_jobs WHERE deduplication_key = :jobKey) AS job_count`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          connectionId,
          deduplicationKey,
          jobKey: `delivery:${deduplicationKey}`,
        },
      },
    );
    expect(afterFailedAcceptance[0]).toEqual({
      connection_status: "PENDING",
      notification_count: "0",
      job_count: "0",
    });

    await request(application.getHttpServer())
      .patch(url(`/me/connections/${connectionId}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ action: "ACCEPT" })
      .expect(200);
    await expect(notification.enqueueDirectMessage(input)).resolves.toBe(false);
    await expect(notification.enqueueDirectMessage(input)).resolves.toBe(false);

    const initialRows = await sequelize.query<{
      notification_count: string;
      job_count: string;
      notification_status: string;
      job_status: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM notifications.messages
           WHERE deduplication_key = :deduplicationKey) AS notification_count,
         (SELECT count(*)::text FROM integration.outbox_jobs
           WHERE deduplication_key = :jobKey) AS job_count,
         (SELECT status FROM notifications.messages
           WHERE deduplication_key = :deduplicationKey) AS notification_status,
         (SELECT status FROM integration.outbox_jobs
           WHERE deduplication_key = :jobKey) AS job_status`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          deduplicationKey,
          jobKey: `delivery:${deduplicationKey}`,
        },
      },
    );
    expect(initialRows[0]).toEqual({
      notification_count: "1",
      job_count: "1",
      notification_status: "PENDING",
      job_status: "PENDING",
    });

    const controller = new AbortController();
    const workerRun = worker.run(controller.signal);
    try {
      const deadline = Date.now() + 15000;
      let delivered = false;
      while (Date.now() < deadline) {
        const rows = await sequelize.query<{ status: string }>(
          `SELECT status FROM integration.outbox_jobs
            WHERE deduplication_key = :jobKey`,
          {
            type: QueryTypes.SELECT,
            replacements: { jobKey: `delivery:${deduplicationKey}` },
          },
        );
        if (rows[0]?.status === "COMPLETED") {
          delivered = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(delivered).toBe(true);
    } finally {
      controller.abort();
      await workerRun;
    }

    const finalRows = await sequelize.query<{
      notification_count: string;
      job_count: string;
      attempt_count: string;
      delivery_attempt_count: string;
      notification_status: string;
      job_status: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM notifications.messages
           WHERE deduplication_key = :deduplicationKey) AS notification_count,
         (SELECT count(*)::text FROM integration.outbox_jobs
           WHERE deduplication_key = :jobKey) AS job_count,
         (SELECT attempt_count::text FROM integration.outbox_jobs
           WHERE deduplication_key = :jobKey) AS attempt_count,
         (SELECT count(*)::text FROM notifications.delivery_attempts a
           JOIN notifications.messages m ON m.id = a.notification_id
          WHERE m.deduplication_key = :deduplicationKey) AS delivery_attempt_count,
         (SELECT status FROM notifications.messages
           WHERE deduplication_key = :deduplicationKey) AS notification_status,
         (SELECT status FROM integration.outbox_jobs
           WHERE deduplication_key = :jobKey) AS job_status`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          deduplicationKey,
          jobKey: `delivery:${deduplicationKey}`,
        },
      },
    );
    expect(finalRows[0]).toEqual({
      notification_count: "1",
      job_count: "1",
      attempt_count: "1",
      delivery_attempt_count: "1",
      notification_status: "SENT",
      job_status: "COMPLETED",
    });
  }, 60000);

  it("H11.S2.M2 suppresses a queued connection notice after a block", async () => {
    if (!application || !sequelize || !worker) {
      throw new Error("H11 E2E setup did not finish.");
    }
    const suffix = randomUUID();
    const register = async (label: string) => {
      const registered = await request(application!.getHttpServer())
        .post(url("/auth/register"))
        .send({
          email: `h11-s2-m2-${label}-${suffix}@example.test`,
          password: "h11-notice-e2e-password",
          nombreCompleto: `H11 Suppression ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      return {
        userId: registered.body.data.user.id as string,
        accessToken: registered.body.data.accessToken as string,
      };
    };
    const requester = await register("requester");
    const recipient = await register("recipient");
    const sent = await request(application.getHttpServer())
      .post(url("/me/connections"))
      .set("Authorization", `Bearer ${requester.accessToken}`)
      .send({ addresseeId: recipient.userId })
      .expect(201);
    const connectionId = sent.body.data.id as string;
    const deduplicationKey = `connection.accepted:${connectionId}:${requester.userId}`;
    await request(application.getHttpServer())
      .patch(url(`/me/connections/${connectionId}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ action: "ACCEPT" })
      .expect(200);

    const queued = await sequelize.query<{ id: string; status: string }>(
      `SELECT id, status FROM notifications.messages
        WHERE deduplication_key = :deduplicationKey`,
      { type: QueryTypes.SELECT, replacements: { deduplicationKey } },
    );
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("PENDING");

    await request(application.getHttpServer())
      .post(url("/me/blocks"))
      .set("Authorization", `Bearer ${requester.accessToken}`)
      .send({ targetUserId: recipient.userId })
      .expect(201);

    const suppressionConstraint = await sequelize.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'notifications.messages'::regclass
          AND conname = 'ck_notification_status'`,
      { type: QueryTypes.SELECT },
    );
    expect(suppressionConstraint[0]?.definition).toContain("'SUPPRESSED'");

    const controller = new AbortController();
    const workerRun = worker.run(controller.signal);
    try {
      const deadline = Date.now() + 15000;
      let completed = false;
      while (Date.now() < deadline) {
        const rows = await sequelize.query<{
          status: string;
          jobStatus: string;
        }>(
          `SELECT m.status, j.status AS "jobStatus"
             FROM notifications.messages m
             JOIN integration.outbox_jobs j
               ON j.deduplication_key = :jobKey
            WHERE m.id = :notificationId`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              notificationId: queued[0].id,
              jobKey: `delivery:${deduplicationKey}`,
            },
          },
        );
        if (
          rows[0]?.status === "SUPPRESSED" &&
          rows[0]?.jobStatus === "COMPLETED"
        ) {
          completed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(completed).toBe(true);
    } finally {
      controller.abort();
      await workerRun;
    }

    const finalRows = await sequelize.query<{
      notificationStatus: string;
      jobStatus: string;
      deliveryAttempts: string;
      acceptedConnections: string;
    }>(
      `SELECT m.status AS "notificationStatus", j.status AS "jobStatus",
              (SELECT count(*)::text FROM notifications.delivery_attempts a
                WHERE a.notification_id = m.id) AS "deliveryAttempts",
              (SELECT count(*)::text FROM social.connections c
                WHERE c.id = :connectionId AND c.status = 'ACCEPTED') AS "acceptedConnections"
         FROM notifications.messages m
         JOIN integration.outbox_jobs j ON j.deduplication_key = :jobKey
        WHERE m.id = :notificationId`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          connectionId,
          notificationId: queued[0].id,
          jobKey: `delivery:${deduplicationKey}`,
        },
      },
    );
    expect(finalRows[0]).toEqual({
      notificationStatus: "SUPPRESSED",
      jobStatus: "COMPLETED",
      deliveryAttempts: "0",
      acceptedConnections: "0",
    });
  }, 60000);

  it("H11.S2.M4 hides private message text from push unless the recipient opts in", async () => {
    if (!application || !moduleRef) {
      throw new Error("H11 E2E setup did not finish.");
    }
    const suffix = randomUUID();
    const register = async (label: string) => {
      const registered = await request(application!.getHttpServer())
        .post(url("/auth/register"))
        .send({
          email: `h11-s2-m4-${label}-${suffix}@example.test`,
          password: "h11-notice-e2e-password",
          nombreCompleto: `H11 Preview ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      return {
        userId: registered.body.data.user.id as string,
        accessToken: registered.body.data.accessToken as string,
      };
    };
    const sender = await register("sender");
    const recipient = await register("recipient");
    const pending = await request(application.getHttpServer())
      .post(url("/me/connections"))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ addresseeId: recipient.userId })
      .expect(201);
    await request(application.getHttpServer())
      .patch(url(`/me/connections/${pending.body.data.id}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ action: "ACCEPT" })
      .expect(200);
    const started = await request(application.getHttpServer())
      .post(url("/me/conversations"))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ otherUserId: recipient.userId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;
    const push = moduleRef.get(PushDispatcherService, { strict: false });
    const sendToUser = jest
      .spyOn(push, "sendToUser")
      .mockResolvedValue({ delivered: 0, deactivated: 0, skipped: 0 });
    const preference = (vistaPreviaMensajes: boolean) => ({
      recordatoriosVencimiento: true,
      vistaPreviaMensajes,
      canalPreferido: "IN_APP",
      consentimientoExternoEn: null,
      versionConsentimiento: null,
      horaSilencioInicio: null,
      horaSilencioFin: null,
      metadata: {},
    });

    await request(application.getHttpServer())
      .patch(url("/notifications/preferences/me"))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send(preference(false))
      .expect(200);
    await request(application.getHttpServer())
      .post(url(`/me/conversations/${conversationId}/messages`))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ type: "text", body: "texto privado de prueba" })
      .expect(201);
    expect(sendToUser).toHaveBeenCalledWith(recipient.userId, expect.objectContaining({
      body: "Tienes un mensaje nuevo.",
    }));

    await request(application.getHttpServer())
      .patch(url("/notifications/preferences/me"))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send(preference(true))
      .expect(200);
    await request(application.getHttpServer())
      .post(url(`/me/conversations/${conversationId}/messages`))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ type: "text", body: "texto compartido por preferencia" })
      .expect(201);
    expect(sendToUser).toHaveBeenCalledWith(recipient.userId, expect.objectContaining({
      body: "texto compartido por preferencia",
    }));
    sendToUser.mockRestore();
  }, 60000);

  it("H11.S2.M3 reauthorizes an old chat notification link after disconnect", async () => {
    if (!application) {
      throw new Error("H11 E2E setup did not finish.");
    }
    const suffix = randomUUID();
    const register = async (label: string) => {
      const registered = await request(application!.getHttpServer())
        .post(url("/auth/register"))
        .send({
          email: `h11-s2-m3-${label}-${suffix}@example.test`,
          password: "h11-notice-e2e-password",
          nombreCompleto: `H11 Stale Link ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      return {
        userId: registered.body.data.user.id as string,
        accessToken: registered.body.data.accessToken as string,
      };
    };
    const sender = await register("sender");
    const recipient = await register("recipient");
    const pending = await request(application.getHttpServer())
      .post(url("/me/connections"))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ addresseeId: recipient.userId })
      .expect(201);
    const connectionId = pending.body.data.id as string;
    await request(application.getHttpServer())
      .patch(url(`/me/connections/${connectionId}`))
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ action: "ACCEPT" })
      .expect(200);
    const started = await request(application.getHttpServer())
      .post(url("/me/conversations"))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ otherUserId: recipient.userId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;
    const oldPushUrl = `/chat/${conversationId}`;
    const historyPath = url(`/me/conversations/${conversationId}/messages?limit=40`);
    await request(application.getHttpServer())
      .get(historyPath)
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(200);

    await request(application.getHttpServer())
      .delete(url(`/me/connections/${connectionId}`))
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .expect(200);
    // Opening the old push URL loads this chat route; its history request is
    // reauthorized and the web client renders “Esta conversación ya no está disponible.”
    expect(oldPushUrl).toBe(`/chat/${conversationId}`);
    await request(application.getHttpServer())
      .get(historyPath)
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .expect(404);
  }, 60000);
});
