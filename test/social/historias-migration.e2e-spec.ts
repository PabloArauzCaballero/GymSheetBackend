import { Test, TestingModule } from "@nestjs/testing";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { randomUUID } from "crypto";
import { runMigrations } from "../../src/database/migrate";
import { databaseMigrations } from "../../src/database/migrations";
import { AppModule } from "../../src/app.module";
import { env } from "../../src/config/env";
import { storyUploadIdempotencyMigration } from "../../src/database/migrations/202610100004-story-upload-idempotency";

describe("story upload idempotency migration compatibility (e2e)", () => {
  let moduleRef: TestingModule | undefined;
  let sequelize: Sequelize;

  beforeAll(async () => {
    if (env.DB_NAME !== "gymsheet_social_qa" || !["127.0.0.1", "localhost"].includes(env.DB_HOST)) {
      throw new Error("H8.S4.M1 only runs against the isolated local gymsheet_social_qa database.");
    }
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    sequelize = moduleRef.get(Sequelize);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("H8.S4.M1 preserves old story rows across upload-idempotency migration rollback/up and enforces new constraints", async () => {
    const [applied] = await sequelize.query<{ id: string }>(
      `SELECT id FROM app_meta.schema_migrations WHERE id = :migrationId`,
      {
        type: QueryTypes.SELECT,
        replacements: { migrationId: storyUploadIdempotencyMigration.id },
      },
    );
    expect(applied?.id).toBe(storyUploadIdempotencyMigration.id);

    const [owner] = await sequelize.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM public.usuarios ORDER BY id LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    expect(owner).toBeDefined();

    const legacyStoryId = randomUUID();
    const idempotentStoryId = randomUUID();
    const duplicateStoryId = randomUUID();
    const legacyStorageKey = `h8-s4-m1/${legacyStoryId}.jpg`;
    const idempotentStorageKey = `h8-s4-m1/${idempotentStoryId}.jpg`;
    const requestId = randomUUID();
    const contentHash = "a".repeat(64);

    await sequelize.transaction(async (transaction) => {
      // Restore the exact pre-M3 story table shape, insert a synthetic old row,
      // and reapply M3. Transactional DDL guarantees failure restores QA schema.
      await storyUploadIdempotencyMigration.down(sequelize.getQueryInterface(), transaction);
      await sequelize.query(
        `INSERT INTO profile.stories
           (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
         VALUES
           (:id, :userId, :tenantId, 'https://legacy.example/story.jpg', 'LOCAL', :storageKey, 'image', NOW() + interval '1 day')`,
        {
          transaction,
          replacements: { id: legacyStoryId, userId: owner.id, tenantId: owner.tenant_id, storageKey: legacyStorageKey },
        },
      );
      await storyUploadIdempotencyMigration.up(sequelize.getQueryInterface(), transaction);

      const [preserved] = await sequelize.query<{
        id: string;
        media_url: string;
        audience_mode: string;
        upload_request_id: string | null;
        upload_content_hash: string | null;
      }>(
        `SELECT id, media_url, audience_mode, upload_request_id, upload_content_hash
           FROM profile.stories WHERE id = :id`,
        { type: QueryTypes.SELECT, transaction, replacements: { id: legacyStoryId } },
      );
      expect(preserved).toEqual({
        id: legacyStoryId,
        media_url: "https://legacy.example/story.jpg",
        audience_mode: "ALL_CONNECTIONS",
        upload_request_id: null,
        upload_content_hash: null,
      });

      const expectConstraintError = async (
        savepoint: string,
        expectedCode: "23505" | "23514",
        values: { id: string; requestId: string | null; hash: string | null },
      ) => {
        await sequelize.query(`SAVEPOINT ${savepoint}`, { transaction });
        let caught: unknown;
        try {
          await sequelize.query(
            `INSERT INTO profile.stories
               (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at,
                upload_request_id, upload_content_hash)
             VALUES
               (:id, :userId, :tenantId, 'https://synthetic.example/story.jpg', 'LOCAL', :storageKey, 'image',
                NOW() + interval '1 day', :requestId, :hash)`,
            {
              transaction,
              replacements: {
                ...values,
                userId: owner.id,
                tenantId: owner.tenant_id,
                storageKey: `h8-s4-m1/${values.id}.jpg`,
              },
            },
          );
        } catch (error) {
          caught = error;
        }
        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepoint}`, { transaction });
        expect(caught).toMatchObject({ original: { code: expectedCode } });
      };

      await sequelize.query(
        `INSERT INTO profile.stories
           (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at,
            upload_request_id, upload_content_hash)
         VALUES
           (:id, :userId, :tenantId, 'https://synthetic.example/story.jpg', 'LOCAL', :storageKey, 'image',
            NOW() + interval '1 day', :requestId, :hash)`,
        {
          transaction,
          replacements: {
            id: idempotentStoryId,
            userId: owner.id,
            tenantId: owner.tenant_id,
            storageKey: idempotentStorageKey,
            requestId,
            hash: contentHash,
          },
        },
      );

      await expectConstraintError("story_pair_check", "23514", {
        id: randomUUID(), requestId, hash: null,
      });
      await expectConstraintError("story_hash_format_check", "23514", {
        id: randomUUID(), requestId: randomUUID(), hash: "not-a-sha256",
      });
      await expectConstraintError("story_request_unique", "23505", {
        id: duplicateStoryId, requestId, hash: contentHash,
      });

      const [duplicateRows] = await sequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM profile.stories
          WHERE user_id = :userId AND upload_request_id = :requestId`,
        { type: QueryTypes.SELECT, transaction, replacements: { userId: owner.id, requestId } },
      );
      expect(duplicateRows.count).toBe("1");

      await sequelize.query(
        `DELETE FROM profile.stories WHERE id IN (:ids)`,
        { transaction, replacements: { ids: [legacyStoryId, idempotentStoryId] } },
      );
      const [remaining] = await sequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM profile.stories WHERE id IN (:ids)`,
        { type: QueryTypes.SELECT, transaction, replacements: { ids: [legacyStoryId, idempotentStoryId, duplicateStoryId] } },
      );
      expect(remaining.count).toBe("0");
    });
  }, 60000);

  it("H8.S4.M2 reapplies the full migration registry to an empty database and inserts a story fixture", async () => {
    const originalDatabase = env.DB_NAME;
    const isolatedDatabase = `h8_s4_m2_${randomUUID().replace(/-/g, "")}`;
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
        expect(migrations.some(({ id }) => id === storyUploadIdempotencyMigration.id)).toBe(true);

        const ownerEmail = `h8-s4-m2-owner-${randomUUID()}@example.test`;
        const recipientEmail = `h8-s4-m2-recipient-${randomUUID()}@example.test`;
        const [owner] = await fresh.query<{ id: string }>(
          `INSERT INTO public.usuarios (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'test-hash', 'H8 S4 M2 Owner', :tenantId) RETURNING id`,
          { type: QueryTypes.SELECT, replacements: { email: ownerEmail, tenantId: env.DEFAULT_TENANT_ID } },
        );
        const [recipient] = await fresh.query<{ id: string }>(
          `INSERT INTO public.usuarios (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'test-hash', 'H8 S4 M2 Recipient', :tenantId) RETURNING id`,
          { type: QueryTypes.SELECT, replacements: { email: recipientEmail, tenantId: env.DEFAULT_TENANT_ID } },
        );
        const storyId = randomUUID();
        const uploadRequestId = randomUUID();
        await fresh.query(
          `INSERT INTO profile.stories
             (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at,
              audience_mode, upload_request_id, upload_content_hash)
           VALUES
             (:storyId, :ownerId, :tenantId, 'https://synthetic.example/story.jpg', 'LOCAL', :storageKey, 'image',
              NOW() + interval '1 day', 'SELECTED_CONNECTIONS', :uploadRequestId, :contentHash)`,
          {
            replacements: {
              storyId,
              ownerId: owner.id,
              tenantId: env.DEFAULT_TENANT_ID,
              storageKey: `h8-s4-m2/${storyId}.jpg`,
              uploadRequestId,
              contentHash: "b".repeat(64),
            },
          },
        );
        await fresh.query(
          `INSERT INTO profile.story_audiences (story_id, user_id) VALUES (:storyId, :recipientId)`,
          { replacements: { storyId, recipientId: recipient.id } },
        );

        const [fixture] = await fresh.query<{
          id: string;
          audience_mode: string;
          upload_request_id: string;
          upload_content_hash: string;
          audience_count: number;
        }>(
          `SELECT s.id, s.audience_mode, s.upload_request_id, s.upload_content_hash,
                  count(a.user_id)::int AS audience_count
             FROM profile.stories s
             JOIN profile.story_audiences a ON a.story_id = s.id
            WHERE s.id = :storyId
            GROUP BY s.id`,
          { type: QueryTypes.SELECT, replacements: { storyId } },
        );
        expect(fixture).toEqual({
          id: storyId,
          audience_mode: "SELECTED_CONNECTIONS",
          upload_request_id: uploadRequestId,
          upload_content_hash: "b".repeat(64),
          audience_count: 1,
        });
      } finally {
        await fresh.close();
      }
    } finally {
      env.DB_NAME = originalDatabase;
      await admin.query(`DROP DATABASE IF EXISTS "${isolatedDatabase}" WITH (FORCE)`);
      await admin.close();
    }
  }, 120000);
});
