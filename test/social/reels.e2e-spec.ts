import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "crypto";
import { json, urlencoded } from "express";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { env } from "../../src/config/env";
import { runMigrations } from "../../src/database/migrate";
import { databaseMigrations } from "../../src/database/migrations";
import { reelsMigration } from "../../src/database/migrations/202610100005-reels";
import { reelUploadIdempotencyMigration } from "../../src/database/migrations/202610110001-reel-upload-idempotency";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "../../src/modules/media/media-storage.port";

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function fullBox(version: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([version, 0, 0, 0]), payload]);
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function testMp4(
  durationTicks: number,
  timescale = 10,
  handler = "vide",
): Buffer {
  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from("isom", "ascii"),
      Buffer.alloc(4),
      Buffer.from("mp42", "ascii"),
    ]),
  );
  const mdhdFields = Buffer.alloc(16);
  mdhdFields.writeUInt32BE(0, 0);
  mdhdFields.writeUInt32BE(0, 4);
  mdhdFields.writeUInt32BE(timescale, 8);
  mdhdFields.writeUInt32BE(durationTicks, 12);
  const mdhd = box("mdhd", fullBox(0, mdhdFields));
  const hdlrFields = Buffer.alloc(24);
  hdlrFields.write(handler, 4, 4, "ascii");
  const hdlr = box("hdlr", fullBox(0, hdlrFields));
  const stsd = box(
    "stsd",
    fullBox(0, Buffer.concat([u32(1), box("avc1", Buffer.alloc(8))])),
  );
  const stts = box(
    "stts",
    fullBox(0, Buffer.concat([u32(1), u32(1), u32(durationTicks)])),
  );
  const stsz = box("stsz", fullBox(0, Buffer.concat([u32(0), u32(1), u32(4)])));
  const stsc = box(
    "stsc",
    fullBox(0, Buffer.concat([u32(1), u32(1), u32(1), u32(1)])),
  );
  const buildMoov = (chunkOffset: number) => {
    const stco = box(
      "stco",
      fullBox(0, Buffer.concat([u32(1), u32(chunkOffset)])),
    );
    const stbl = box("stbl", Buffer.concat([stsd, stts, stsz, stsc, stco]));
    const minf = box("minf", stbl);
    const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));
    const trak = box("trak", mdia);
    const movieHeader = Buffer.alloc(96);
    movieHeader.writeUInt32BE(1000, 8);
    movieHeader.writeUInt32BE(
      Math.ceil((durationTicks / timescale) * 1000),
      12,
    );
    return box(
      "moov",
      Buffer.concat([box("mvhd", fullBox(0, movieHeader)), trak]),
    );
  };
  const initialMoov = buildMoov(0);
  const moov = buildMoov(ftyp.length + initialMoov.length + 8);
  const mdat = box("mdat", Buffer.from([0, 0, 0, 0]));
  return Buffer.concat([ftyp, moov, mdat]);
}

describe("reels publication and owner feed (e2e)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let sequelize: Sequelize;
  let failNextStorageUpload = false;
  let failAfterStorageWriteOnce = false;
  const storedReelObjects = new Map<string, string>();
  const createdReelIds: string[] = [];
  const createdUserIds: string[] = [];
  const downloadedMedia = Buffer.from("private reel bytes");
  const storage: MediaStorageProvider = {
    name: "local",
    immutable: false,
    upload: jest.fn(async (input, target) => {
      if (target.category !== "reels")
        throw new Error("Unexpected storage target");
      if (failNextStorageUpload) {
        failNextStorageUpload = false;
        throw new Error("Synthetic interrupted storage upload");
      }
      const checksumSha256 = createHash("sha256")
        .update(input.buffer)
        .digest("hex");
      const key = `users/${target.ownerUserId}/reels/${checksumSha256}.mp4`;
      const reused = storedReelObjects.has(key);
      storedReelObjects.set(key, checksumSha256);
      if (failAfterStorageWriteOnce) {
        failAfterStorageWriteOnce = false;
        throw new Error("Synthetic worker interruption after output write");
      }
      return {
        provider: "local" as const,
        key,
        url: `https://private-storage.example/users/${target.ownerUserId}/reels/${checksumSha256}.mp4`,
        sizeBytes: input.buffer.byteLength,
        checksumSha256,
        reused,
      };
    }),
    download: jest.fn(async () => downloadedMedia),
    remove: jest.fn(async () => undefined),
  };
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    if (
      env.DB_NAME !== "gymsheet_social_qa" ||
      !["127.0.0.1", "localhost"].includes(env.DB_HOST) ||
      Number(env.DB_PORT) !== 55432
    ) {
      throw new Error(
        "Reels E2E tests run only against the isolated local gymsheet_social_qa database.",
      );
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_PROVIDER)
      .useValue(storage)
      .compile();
    sequelize = moduleRef.get(Sequelize);
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
    httpServer = application.getHttpServer();
  }, 60000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    if (sequelize && createdReelIds.length > 0) {
      try {
        await sequelize.query("DELETE FROM social.reels WHERE id IN (:ids)", {
          replacements: { ids: createdReelIds },
        });
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (sequelize && createdUserIds.length > 0) {
      try {
        await sequelize.query(
          "DELETE FROM public.usuarios WHERE id IN (:ids)",
          {
            replacements: { ids: createdUserIds },
          },
        );
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    try {
      await application?.close();
    } catch (error: unknown) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Reels E2E cleanup failed");
    }
  });

  it("H9.S1.M1 checks duration; H9.S1.M2 excludes incomplete uploads; H9.S1.M4 rejects false MP4; protects owner media", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = async (label: string) => {
      const response = await request(httpServer)
        .post(url("/auth/register"))
        .send({
          email: `reels-${label}-${suffix}@example.test`,
          password: "reels-e2e-password",
          nombreCompleto: `Reels ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      const user = {
        accessToken: response.body.data.accessToken as string,
        userId: response.body.data.user.id as string,
      };
      createdUserIds.push(user.userId);
      return user;
    };

    const owner = await register("owner");
    const stranger = await register("stranger");
    const upload = async (ticks: number, expectedStatus = 201) => {
      const response = await request(httpServer)
        .post(url("/me/reels"))
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .attach("file", testMp4(ticks), {
          filename: "reel.mp4",
          contentType: "video/mp4",
        });
      if (response.status !== expectedStatus) {
        throw new Error(
          `Expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(response.body)}`,
        );
      }
      if (
        response.status === 201 &&
        typeof response.body.data?.id === "string"
      ) {
        createdReelIds.push(response.body.data.id as string);
      }
      return response;
    };

    const underLimit = await upload(899);
    const atLimit = await upload(900);
    expect(underLimit.body.data.durationSeconds).toBe(89.9);
    expect(atLimit.body.data.durationSeconds).toBe(90);
    expect(underLimit.body.data.mediaUrl).toBe(
      `/me/reels/${underLimit.body.data.id}/media`,
    );
    expect(underLimit.body.data.mediaUrl).not.toContain(
      "private-storage.example",
    );

    await upload(901, 400);
    await request(httpServer)
      .post(url("/me/reels"))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .attach("file", Buffer.from("not an MP4"), {
        filename: "fake.mp4",
        contentType: "video/mp4",
      })
      .expect(400);

    failNextStorageUpload = true;
    await upload(600, 500);
    const interruptedRows = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM social.reels
        WHERE user_id = :userId AND duration_seconds = 60`,
      { type: QueryTypes.SELECT, replacements: { userId: owner.userId } },
    );
    expect(interruptedRows[0].count).toBe("0");

    const [processing] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.reels (user_id, tenant_id, storage_provider, storage_key, mime_type, duration_seconds, status)
       VALUES (:userId, :tenantId, 'local', :storageKey, 'video/mp4', 60, 'PROCESSING') RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId: owner.userId,
          tenantId: env.DEFAULT_TENANT_ID,
          storageKey: `users/${owner.userId}/reels/processing.mp4`,
        },
      },
    );
    createdReelIds.push(processing.id);

    const ownFeed = await request(httpServer)
      .get(url("/me/reels/feed"))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const feedIds = (ownFeed.body.data.items as Array<{ id: string }>).map(
      (item) => item.id,
    );
    expect(feedIds).toContain(underLimit.body.data.id);
    expect(feedIds).toContain(atLimit.body.data.id);
    expect(feedIds).not.toContain(processing.id);
    expect(ownFeed.body.data.nextCursor).toBeNull();

    const strangerFeed = await request(httpServer)
      .get(url("/me/reels/feed"))
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .expect(200);
    expect(strangerFeed.body.data.items).toEqual([]);

    await request(httpServer)
      .get(url(`/me/reels/${underLimit.body.data.id}/media`))
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .expect(404);
    const ownMedia = await request(httpServer)
      .get(url(`/me/reels/${underLimit.body.data.id}/media`))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(ownMedia.body).toEqual(downloadedMedia);
    expect(storage.download).toHaveBeenCalledTimes(1);

    const persisted = await sequelize.query<{
      status: string;
      duration_seconds: string;
      storage_key: string;
    }>(
      `SELECT status, duration_seconds::text, storage_key FROM social.reels WHERE id = :reelId`,
      {
        type: QueryTypes.SELECT,
        replacements: { reelId: underLimit.body.data.id },
      },
    );
    expect(persisted[0]).toEqual({
      status: "READY",
      duration_seconds: "89.900",
      storage_key: expect.stringMatching(
        new RegExp(`^users/${owner.userId}/reels/[a-f0-9]{64}\\.mp4$`),
      ),
    });
  });

  it("H9.S1.M3 retries the same processing request without duplicate reels or stored outputs", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await request(httpServer)
      .post(url("/auth/register"))
      .send({
        email: `reels-retry-${suffix}@example.test`,
        password: "reels-e2e-password",
        nombreCompleto: `Reels Retry ${suffix}`,
        acceptedTerms: true,
      })
      .expect(201);
    const userId = response.body.data.user.id as string;
    const token = response.body.data.accessToken as string;
    createdUserIds.push(userId);

    const requestId = randomUUID();
    const video = testMp4(300);
    const checksum = createHash("sha256").update(video).digest("hex");
    const expectedStorageKey = `users/${userId}/reels/${checksum}.mp4`;
    const upload = (file: Buffer) =>
      request(httpServer)
        .post(url("/me/reels"))
        .set("Authorization", `Bearer ${token}`)
        .field("requestId", requestId)
        .attach("file", file, {
          filename: "retry-reel.mp4",
          contentType: "video/mp4",
        });

    failAfterStorageWriteOnce = true;
    try {
      await upload(video).expect(500);
      const [failed] = await sequelize.query<{
        id: string;
        status: string;
        storage_key: string;
        processing_attempt_count: number;
        processing_content_sha256: string;
      }>(
        `SELECT id, status, storage_key, processing_attempt_count,
                processing_content_sha256
           FROM social.reels
          WHERE user_id = :userId AND processing_request_id = :requestId`,
        {
          type: QueryTypes.SELECT,
          replacements: { userId, requestId },
        },
      );
      expect(failed).toMatchObject({
        status: "FAILED",
        storage_key: `pending/${userId}/reels/${requestId}`,
        processing_attempt_count: 1,
        processing_content_sha256: checksum,
      });
      expect(storedReelObjects.get(expectedStorageKey)).toBe(checksum);

      const retried = await upload(video).expect(201);
      expect(retried.body.data).toMatchObject({
        id: failed.id,
        status: "READY",
        mediaUrl: `/me/reels/${failed.id}/media`,
      });

      const [ready] = await sequelize.query<{
        id: string;
        status: string;
        storage_key: string;
        processing_attempt_count: number;
      }>(
        `SELECT id, status, storage_key, processing_attempt_count
           FROM social.reels
          WHERE user_id = :userId AND processing_request_id = :requestId`,
        {
          type: QueryTypes.SELECT,
          replacements: { userId, requestId },
        },
      );
      expect(ready).toEqual({
        id: failed.id,
        status: "READY",
        storage_key: expectedStorageKey,
        processing_attempt_count: 2,
      });
      expect([...storedReelObjects.keys()].filter((key) => key === expectedStorageKey)).toHaveLength(1);

      const storageUploadCalls = (storage.upload as jest.Mock).mock.calls.length;
      const replay = await upload(video).expect(201);
      expect(replay.body.data.id).toBe(failed.id);
      expect((storage.upload as jest.Mock).mock.calls).toHaveLength(storageUploadCalls);

      await upload(testMp4(301)).expect(409);
      expect((storage.upload as jest.Mock).mock.calls).toHaveLength(storageUploadCalls);
      const [count] = await sequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM social.reels
          WHERE user_id = :userId AND processing_request_id = :requestId`,
        {
          type: QueryTypes.SELECT,
          replacements: { userId, requestId },
        },
      );
      expect(count.count).toBe("1");

      await expect(
        sequelize.transaction((transaction) =>
          reelUploadIdempotencyMigration.down(
            sequelize.getQueryInterface(),
            transaction,
          ),
        ),
      ).rejects.toThrow(
        "Cannot roll back reel upload idempotency while processing state exists",
      );
      const [identityStillPresent] = await sequelize.query<{
        id: string;
        processing_request_id: string;
      }>(
        `SELECT id, processing_request_id
           FROM social.reels
          WHERE user_id = :userId AND processing_request_id = :requestId`,
        {
          type: QueryTypes.SELECT,
          replacements: { userId, requestId },
        },
      );
      expect(identityStillPresent).toEqual({
        id: failed.id,
        processing_request_id: requestId,
      });
    } finally {
      failAfterStorageWriteOnce = false;
    }
  });

  it("H9.S4.M1 preserves pre-existing rows and enforces reel migration constraints", async () => {
    if (
      env.DB_NAME !== "gymsheet_social_qa" ||
      env.DB_HOST !== "127.0.0.1" ||
      Number(env.DB_PORT) !== 55432
    ) {
      throw new Error(
        "H9.S4.M1 runs only against the isolated 127.0.0.1:55432 QA PostgreSQL server.",
      );
    }

    const originalDatabase = env.DB_NAME;
    const isolatedDatabase = `h9_s4_m1_${randomUUID().replace(/-/g, "")}`;
    const admin = new Sequelize({
      dialect: "postgres",
      host: "127.0.0.1",
      port: 55432,
      database: "postgres",
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      logging: false,
      dialectOptions: {
        connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
        statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
        ...(env.DB_SSL
          ? {
              ssl: {
                require: true,
                rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
              },
            }
          : {}),
      },
    });
    let fresh: Sequelize | undefined;
    const cleanupErrors: unknown[] = [];
    let testFailure: unknown;
    let testFailed = false;

    try {
      await admin.query(
        `CREATE DATABASE "${isolatedDatabase}" TEMPLATE template0`,
      );
      env.DB_NAME = isolatedDatabase;
      await runMigrations("up");

      fresh = new Sequelize({
        dialect: "postgres",
        host: "127.0.0.1",
        port: 55432,
        database: isolatedDatabase,
        username: env.DB_USER,
        password: env.DB_PASSWORD,
        logging: false,
        dialectOptions: {
          connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
          statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
          ...(env.DB_SSL
            ? {
                ssl: {
                  require: true,
                  rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
                },
              }
            : {}),
        },
      });

      const ownerEmail = `h9-s4-m1-${randomUUID()}@example.test`;
      const storyId = randomUUID();
      const legacyStorageKey = `h9-s4-m1/${storyId}.jpg`;

      await fresh.transaction(async (transaction) => {
        // The registry has already built all prior schema. Remove only the
        // empty reels tables so synthetic legacy rows precede the new migrations.
        await reelUploadIdempotencyMigration.down(
          fresh!.getQueryInterface(),
          transaction,
        );
        await fresh!.query(
          "DELETE FROM app_meta.schema_migrations WHERE id = :migrationId",
          {
            transaction,
            replacements: { migrationId: reelUploadIdempotencyMigration.id },
          },
        );
        await reelsMigration.down(fresh!.getQueryInterface(), transaction);
        await fresh!.query(
          "DELETE FROM app_meta.schema_migrations WHERE id = :migrationId",
          {
            transaction,
            replacements: { migrationId: reelsMigration.id },
          },
        );

        const [owner] = await fresh!.query<{ id: string; tenant_id: string }>(
          `INSERT INTO public.usuarios
             (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'synthetic-hash', 'H9 S4 M1 Owner', :tenantId)
           RETURNING id, tenant_id`,
          {
            type: QueryTypes.SELECT,
            transaction,
            replacements: {
              email: ownerEmail,
              tenantId: env.DEFAULT_TENANT_ID,
            },
          },
        );
        await fresh!.query(
          `INSERT INTO profile.stories
             (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
           VALUES
             (:storyId, :userId, :tenantId, 'https://legacy.example/story.jpg', 'LOCAL', :storageKey,
              'image', NOW() + interval '1 day')`,
          {
            transaction,
            replacements: {
              storyId,
              userId: owner.id,
              tenantId: owner.tenant_id,
              storageKey: legacyStorageKey,
            },
          },
        );

        await reelsMigration.up(fresh!.getQueryInterface(), transaction);
        await fresh!.query(
          `INSERT INTO app_meta.schema_migrations (id, description)
           VALUES (:id, :description)`,
          {
            transaction,
            replacements: {
              id: reelsMigration.id,
              description: reelsMigration.description,
            },
          },
        );
        await reelUploadIdempotencyMigration.up(
          fresh!.getQueryInterface(),
          transaction,
        );
        await fresh!.query(
          `INSERT INTO app_meta.schema_migrations (id, description)
           VALUES (:id, :description)`,
          {
            transaction,
            replacements: {
              id: reelUploadIdempotencyMigration.id,
              description: reelUploadIdempotencyMigration.description,
            },
          },
        );

        const [preservedOwner] = await fresh!.query<{
          id: string;
          email: string;
          tenant_id: string;
        }>(
          `SELECT id, email, tenant_id FROM public.usuarios WHERE email = :email`,
          {
            type: QueryTypes.SELECT,
            transaction,
            replacements: { email: ownerEmail },
          },
        );
        expect(preservedOwner).toEqual({
          id: owner.id,
          email: ownerEmail,
          tenant_id: owner.tenant_id,
        });

        const [preservedStory] = await fresh!.query<{
          id: string;
          media_url: string;
          storage_key: string;
        }>(
          `SELECT id, media_url, storage_key FROM profile.stories WHERE id = :storyId`,
          {
            type: QueryTypes.SELECT,
            transaction,
            replacements: { storyId },
          },
        );
        expect(preservedStory).toEqual({
          id: storyId,
          media_url: "https://legacy.example/story.jpg",
          storage_key: legacyStorageKey,
        });

        const expectCheckViolation = async (
          savepoint: string,
          values: {
            duration: number;
            provider: string;
            status: string;
          },
        ) => {
          await fresh!.query(`SAVEPOINT ${savepoint}`, { transaction });
          let caught: unknown;
          try {
            await fresh!.query(
              `INSERT INTO social.reels
                 (user_id, tenant_id, storage_provider, storage_key, mime_type, duration_seconds, status)
               VALUES (:userId, :tenantId, :provider, :storageKey, 'video/mp4', :duration, :status)`,
              {
                transaction,
                replacements: {
                  userId: owner.id,
                  tenantId: owner.tenant_id,
                  provider: values.provider,
                  storageKey: `h9-s4-m1/${savepoint}.mp4`,
                  duration: values.duration,
                  status: values.status,
                },
              },
            );
          } catch (error: unknown) {
            caught = error;
          }
          await fresh!.query(`ROLLBACK TO SAVEPOINT ${savepoint}`, {
            transaction,
          });
          expect(caught).toMatchObject({ original: { code: "23514" } });
        };

        await expectCheckViolation("invalid_reel_duration", {
          duration: 90.001,
          provider: "local",
          status: "READY",
        });
        await expectCheckViolation("invalid_reel_provider", {
          duration: 60,
          provider: "ftp",
          status: "READY",
        });
        await expectCheckViolation("invalid_reel_status", {
          duration: 60,
          provider: "local",
          status: "UPLOADING",
        });
      });
    } catch (error: unknown) {
      testFailed = true;
      testFailure = error;
    } finally {
      env.DB_NAME = originalDatabase;
      if (fresh) {
        try {
          await fresh.close();
        } catch (error: unknown) {
          cleanupErrors.push(error);
        }
      }
      try {
        await admin.query(
          `DROP DATABASE IF EXISTS "${isolatedDatabase}" WITH (FORCE)`,
        );
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
      try {
        await admin.close();
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (testFailed && cleanupErrors.length > 0) {
      throw new AggregateError(
        [testFailure, ...cleanupErrors],
        "H9.S4.M1 test and cleanup failed",
      );
    }
    if (testFailed) throw testFailure;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "H9.S4.M1 cleanup failed");
    }
  }, 120000);

  it("H9.S4.M2 applies the full migration registry to a fresh database and accepts a reel fixture", async () => {
    if (
      env.DB_NAME !== "gymsheet_social_qa" ||
      !["127.0.0.1", "localhost"].includes(env.DB_HOST) ||
      Number(env.DB_PORT) !== 55432
    ) {
      throw new Error(
        "H9.S4.M2 runs only against the local isolated-QA PostgreSQL server.",
      );
    }
    const originalDatabase = env.DB_NAME;
    const isolatedDatabase = `h9_s4_m2_${randomUUID().replace(/-/g, "")}`;
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
        ...(env.DB_SSL
          ? {
              ssl: {
                require: true,
                rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
              },
            }
          : {}),
      },
    });

    try {
      await admin.query(
        `CREATE DATABASE "${isolatedDatabase}" TEMPLATE template0`,
      );
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
          ...(env.DB_SSL
            ? {
                ssl: {
                  require: true,
                  rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
                },
              }
            : {}),
        },
      });

      try {
        const applied = await fresh.query<{ id: string }>(
          "SELECT id FROM app_meta.schema_migrations ORDER BY id",
          { type: QueryTypes.SELECT },
        );
        expect(applied.map(({ id }) => id)).toEqual(
          databaseMigrations.map(({ id }) => id).sort(),
        );
        const [owner] = await fresh.query<{ id: string }>(
          `INSERT INTO public.usuarios (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'test-hash', 'H9 S4 M2 Owner', :tenantId) RETURNING id`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              email: `h9-s4-m2-${randomUUID()}@example.test`,
              tenantId: env.DEFAULT_TENANT_ID,
            },
          },
        );
        const [reel] = await fresh.query<{
          id: string;
          duration_seconds: string;
        }>(
          `INSERT INTO social.reels
             (user_id, tenant_id, storage_provider, storage_key, mime_type, duration_seconds, status)
           VALUES (:userId, :tenantId, 'local', 'fixture/reel.mp4', 'video/mp4', 60, 'READY')
           RETURNING id, duration_seconds::text`,
          {
            type: QueryTypes.SELECT,
            replacements: { userId: owner.id, tenantId: env.DEFAULT_TENANT_ID },
          },
        );
        expect(reel.id).toMatch(/^[0-9a-f-]{36}$/iu);
        expect(reel.duration_seconds).toBe("60.000");

        await expect(
          fresh.transaction((transaction) =>
            reelsMigration.down(fresh.getQueryInterface(), transaction),
          ),
        ).rejects.toThrow(
          "Cannot roll back reels migration while user media records exist",
        );
        const [preservedReel] = await fresh.query<{ id: string }>(
          "SELECT id FROM social.reels WHERE id = :reelId",
          { type: QueryTypes.SELECT, replacements: { reelId: reel.id } },
        );
        expect(preservedReel.id).toBe(reel.id);

        await expect(
          fresh.query(
            `INSERT INTO social.reels
               (user_id, tenant_id, storage_provider, storage_key, mime_type, duration_seconds, status)
             VALUES (:userId, :tenantId, 'local', 'fixture/invalid.mp4', 'video/mp4', 90.1, 'READY')`,
            {
              replacements: {
                userId: owner.id,
                tenantId: env.DEFAULT_TENANT_ID,
              },
            },
          ),
        ).rejects.toMatchObject({ original: { code: "23514" } });
      } finally {
        await fresh.close();
      }
    } finally {
      env.DB_NAME = originalDatabase;
      await admin.query(
        `DROP DATABASE IF EXISTS "${isolatedDatabase}" WITH (FORCE)`,
      );
      await admin.close();
    }
  }, 120000);
});
