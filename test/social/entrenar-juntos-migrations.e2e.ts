import { randomUUID } from "node:crypto";
import { QueryTypes, Sequelize } from "sequelize";
import { env } from "../../src/config/env";
import { runMigrations } from "../../src/database/migrate";
import { databaseMigrations } from "../../src/database/migrations";
import { trainingInvitationsMigration } from "../../src/database/migrations/202610110002-training-invitations";

const h10Migrations = databaseMigrations.filter((migration) =>
  /^202610(?:11000[2-9]|120001)-training-invite/.test(migration.id),
);

function connect(database: string): Sequelize {
  return new Sequelize({
    dialect: "postgres",
    host: env.DB_HOST,
    port: env.DB_PORT,
    database,
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
}

function assertQaDatabase(testId: string): void {
  if (
    env.DB_NAME !== "gymsheet_social_qa" ||
    !["127.0.0.1", "localhost"].includes(env.DB_HOST) ||
    Number(env.DB_PORT) !== 55432
  ) {
    throw new Error(
      `${testId} runs only against the isolated local gymsheet_social_qa PostgreSQL server.`,
    );
  }
}

describe("H10 training-invites migration coverage", () => {
  it("H10.S4.M1 reapplies the module migrations without losing existing users or stories", async () => {
    assertQaDatabase("H10.S4.M1");
    const originalDatabase = env.DB_NAME;
    const isolatedDatabase = `h10_s4_m1_${randomUUID().replace(/-/g, "")}`;
    const admin = connect("postgres");
    let fresh: Sequelize | undefined;
    const cleanupErrors: unknown[] = [];
    let failure: unknown;

    try {
      await admin.query(
        `CREATE DATABASE "${isolatedDatabase}" TEMPLATE template0`,
      );
      env.DB_NAME = isolatedDatabase;
      await runMigrations("up");
      fresh = connect(isolatedDatabase);

      const email = `h10-s4-m1-${randomUUID()}@example.test`;
      const storyId = randomUUID();
      const storageKey = `h10-s4-m1/${storyId}.jpg`;
      await fresh.transaction(async (transaction) => {
        // Remove only the H10 schema on this disposable database to model the
        // pre-feature schema. Existing account and story data are added below.
        for (const migration of [...h10Migrations].reverse()) {
          await migration.down(fresh!.getQueryInterface(), transaction);
          await fresh!.query(
            "DELETE FROM app_meta.schema_migrations WHERE id = :migrationId",
            { transaction, replacements: { migrationId: migration.id } },
          );
        }

        const [owner] = await fresh!.query<{ id: string; tenant_id: string }>(
          `INSERT INTO public.usuarios
             (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'synthetic-hash', 'H10 S4 M1 Owner', :tenantId)
           RETURNING id, tenant_id`,
          {
            type: QueryTypes.SELECT,
            transaction,
            replacements: { email, tenantId: env.DEFAULT_TENANT_ID },
          },
        );
        await fresh!.query(
          `INSERT INTO profile.stories
             (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
           VALUES (:storyId, :userId, :tenantId, 'https://legacy.example/story.jpg',
                   'LOCAL', :storageKey, 'image', NOW() + interval '1 day')`,
          {
            transaction,
            replacements: {
              storyId,
              userId: owner.id,
              tenantId: owner.tenant_id,
              storageKey,
            },
          },
        );

        for (const migration of h10Migrations) {
          await migration.up(fresh!.getQueryInterface(), transaction);
          await fresh!.query(
            `INSERT INTO app_meta.schema_migrations (id, description)
             VALUES (:id, :description)`,
            { transaction, replacements: migration },
          );
        }

        const [preservedUser] = await fresh!.query<{ email: string }>(
          "SELECT email FROM public.usuarios WHERE id = :userId",
          {
            type: QueryTypes.SELECT,
            transaction,
            replacements: { userId: owner.id },
          },
        );
        expect(preservedUser.email).toBe(email);
        const [preservedStory] = await fresh!.query<{
          id: string;
          storage_key: string;
        }>("SELECT id, storage_key FROM profile.stories WHERE id = :storyId", {
          type: QueryTypes.SELECT,
          transaction,
          replacements: { storyId },
        });
        expect(preservedStory).toEqual({
          id: storyId,
          storage_key: storageKey,
        });

        const recipient = await fresh!.query<{ id: string }>(
          `INSERT INTO public.usuarios
             (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'synthetic-hash', 'H10 S4 M1 Recipient', :tenantId)
           RETURNING id`,
          {
            type: QueryTypes.SELECT,
            transaction,
            replacements: {
              email: `h10-s4-m1-recipient-${randomUUID()}@example.test`,
              tenantId: env.DEFAULT_TENANT_ID,
            },
          },
        );
        const inviteId = randomUUID();
        await fresh!.query(
          `INSERT INTO training.training_invites
             (id, inviter_id, recipient_id, client_request_id, request_fingerprint)
           VALUES (:id, :inviterId, :recipientId, :requestId, :fingerprint)`,
          {
            transaction,
            replacements: {
              id: inviteId,
              inviterId: owner.id,
              recipientId: recipient[0].id,
              requestId: randomUUID(),
              fingerprint: "a".repeat(64),
            },
          },
        );
        await fresh!.query(
          `INSERT INTO training.training_invite_revisions
             (invite_id, revision, proposer_id, starts_at, time_zone, place_kind, place_label)
           VALUES (:inviteId, 1, :proposerId, NOW() + interval '1 day', 'UTC', 'PUBLIC_PLACE', 'Park')`,
          { transaction, replacements: { inviteId, proposerId: owner.id } },
        );

        const expectCheckViolation = async (
          savepoint: string,
          statement: () => Promise<unknown>,
        ) => {
          await fresh!.query(`SAVEPOINT ${savepoint}`, { transaction });
          let caught: unknown;
          try {
            await statement();
          } catch (error: unknown) {
            caught = error;
          }
          await fresh!.query(`ROLLBACK TO SAVEPOINT ${savepoint}`, {
            transaction,
          });
          expect(caught).toMatchObject({ original: { code: "23514" } });
        };
        await expectCheckViolation("invalid_invite_self", () =>
          fresh!.query(
            `INSERT INTO training.training_invites
               (id, inviter_id, recipient_id, client_request_id, request_fingerprint)
             VALUES (:id, :userId, :userId, :requestId, :fingerprint)`,
            {
              transaction,
              replacements: {
                id: randomUUID(),
                userId: owner.id,
                requestId: randomUUID(),
                fingerprint: "b".repeat(64),
              },
            },
          ),
        );
        await expectCheckViolation("invalid_revision_duration", () =>
          fresh!.query(
            `INSERT INTO training.training_invite_revisions
               (invite_id, revision, proposer_id, starts_at, time_zone,
                duration_minutes, place_kind, place_label)
             VALUES (:inviteId, 2, :proposerId, NOW() + interval '1 day', 'UTC',
                     361, 'PUBLIC_PLACE', 'Park')`,
            {
              transaction,
              replacements: { inviteId, proposerId: owner.id },
            },
          ),
        );

        await fresh!.query(
          `UPDATE training.training_invites
              SET state = 'DECLINED', responded_by_user_id = :recipientId,
                  responded_revision = 1, responded_at = now()
            WHERE id = :inviteId`,
          {
            transaction,
            replacements: { inviteId, recipientId: recipient[0].id },
          },
        );
        await fresh!.query(
          `INSERT INTO training.training_invite_commands
             (invite_id, actor_user_id, command_type, client_request_id,
              request_fingerprint, result_state, result_revision)
           VALUES (:inviteId, :recipientId, 'RESPOND', :requestId,
                   :fingerprint, 'DECLINED', 1)`,
          {
            transaction,
            replacements: {
              inviteId,
              recipientId: recipient[0].id,
              requestId: randomUUID(),
              fingerprint: "c".repeat(64),
            },
          },
        );
        const [decline] = await fresh!.query<{
          state: string;
          response_actor: string;
          command_state: string;
        }>(
          `SELECT i.state, i.responded_by_user_id AS response_actor,
                  c.result_state AS command_state
             FROM training.training_invites i
             JOIN training.training_invite_commands c ON c.invite_id = i.id
            WHERE i.id = :inviteId`,
          { type: QueryTypes.SELECT, transaction, replacements: { inviteId } },
        );
        expect(decline).toEqual({
          state: "DECLINED",
          response_actor: recipient[0].id,
          command_state: "DECLINED",
        });
      });
    } catch (error: unknown) {
      failure = error;
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
    if (failure && cleanupErrors.length) {
      throw new AggregateError(
        [failure, ...cleanupErrors],
        "H10.S4.M1 test and cleanup failed",
      );
    }
    if (failure) {
      throw failure instanceof Error
        ? failure
        : new Error("H10.S4.M1 failed with a non-Error value");
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "H10.S4.M1 cleanup failed");
    }
  }, 120000);

  it("H10.S4.M2 builds every registered migration from template0 and accepts an invitation fixture", async () => {
    assertQaDatabase("H10.S4.M2");
    const originalDatabase = env.DB_NAME;
    const isolatedDatabase = `h10_s4_m2_${randomUUID().replace(/-/g, "")}`;
    const admin = connect("postgres");

    try {
      await admin.query(
        `CREATE DATABASE "${isolatedDatabase}" TEMPLATE template0`,
      );
      env.DB_NAME = isolatedDatabase;
      await runMigrations("up");
      const fresh = connect(isolatedDatabase);
      try {
        const applied = await fresh.query<{ id: string }>(
          "SELECT id FROM app_meta.schema_migrations ORDER BY id",
          { type: QueryTypes.SELECT },
        );
        expect(applied.map(({ id }) => id)).toEqual(
          databaseMigrations.map(({ id }) => id).sort(),
        );

        const [inviter] = await fresh.query<{ id: string }>(
          `INSERT INTO public.usuarios (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'test-hash', 'H10 S4 M2 Inviter', :tenantId) RETURNING id`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              email: `h10-s4-m2-inviter-${randomUUID()}@example.test`,
              tenantId: env.DEFAULT_TENANT_ID,
            },
          },
        );
        const [recipient] = await fresh.query<{ id: string }>(
          `INSERT INTO public.usuarios (email, password_hash, nombre_completo, tenant_id)
           VALUES (:email, 'test-hash', 'H10 S4 M2 Recipient', :tenantId) RETURNING id`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              email: `h10-s4-m2-recipient-${randomUUID()}@example.test`,
              tenantId: env.DEFAULT_TENANT_ID,
            },
          },
        );
        const inviteId = randomUUID();
        await fresh.query(
          `INSERT INTO training.training_invites
             (id, inviter_id, recipient_id, client_request_id, request_fingerprint)
           VALUES (:id, :inviterId, :recipientId, :requestId, :fingerprint)`,
          {
            replacements: {
              id: inviteId,
              inviterId: inviter.id,
              recipientId: recipient.id,
              requestId: randomUUID(),
              fingerprint: "c".repeat(64),
            },
          },
        );
        await fresh.query(
          `INSERT INTO training.training_invite_revisions
             (invite_id, revision, proposer_id, starts_at, time_zone, duration_minutes,
              place_kind, place_label, mode)
           VALUES (:inviteId, 1, :proposerId, NOW() + interval '1 day', 'UTC', 60,
                   'PUBLIC_PLACE', 'Park', 'OWN_ROUTINES')`,
          { replacements: { inviteId, proposerId: inviter.id } },
        );
        const [fixture] = await fresh.query<{
          invite_id: string;
          revision: number;
          place_label: string;
        }>(
          `SELECT i.id AS invite_id, r.revision, r.place_label
             FROM training.training_invites i
             JOIN training.training_invite_revisions r ON r.invite_id = i.id
            WHERE i.id = :inviteId`,
          { type: QueryTypes.SELECT, replacements: { inviteId } },
        );
        expect(fixture).toEqual({
          invite_id: inviteId,
          revision: 1,
          place_label: "Park",
        });

        await expect(
          fresh.transaction((transaction) =>
            trainingInvitationsMigration.down(
              fresh.getQueryInterface(),
              transaction,
            ),
          ),
        ).rejects.toThrow(
          "Cannot roll back training invitations while invitation records exist",
        );
        const [preserved] = await fresh.query<{ id: string }>(
          "SELECT id FROM training.training_invites WHERE id = :inviteId",
          { type: QueryTypes.SELECT, replacements: { inviteId } },
        );
        expect(preserved.id).toBe(inviteId);
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
