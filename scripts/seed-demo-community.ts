/**
 * Standalone demo-data seeder for the Comunidad/Chat feature.
 *
 * Not part of the app's normal seed pipeline (`src/database/seeders`) on
 * purpose: this exists to make a *populated* community demonstrable —
 * several people in the directory, connection requests in every state,
 * real chat history — which the base/mock seeds don't attempt. It targets
 * whatever Postgres `SEED_DATABASE_URL` points at, connects directly via
 * `pg`/Sequelize (no Nest bootstrap), and is idempotent: re-running it with
 * enough demo users already present is a no-op.
 *
 * Usage:
 *   SEED_DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" \
 *     npx ts-node scripts/seed-demo-community.ts [anchorUserId]
 *
 * The credential is read from the environment only — never hardcode it here.
 */
import { Logger } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { faker } from "@faker-js/faker";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { databaseModels } from "../src/database/models";
import { seedProgression } from "../src/database/seeders/progression.seed";

/** Mismo canal estructurado que `src/database/seeders/seed.ts`: este script
 * es un seeder más, y su salida debe poder leerse junto a la de los otros. */
const logger = new Logger("SeedDemoCommunity");

const TENANT_ID = "topfitness";
const DEMO_PASSWORD = "e2e-strong-password";
const DEMO_EMAIL_DOMAIN = "@demo.gymsheet.test";
const DEMO_USER_COUNT = 10;
const CACHE_THRESHOLD = DEMO_USER_COUNT;

const GOALS = ["HIPERTROFIA", "FUERZA", "RESISTENCIA", "PERDIDA_GRASA", "SALUD_GENERAL", "REHABILITACION"];
const LOCATIONS = ["GYM", "HOME", "OUTDOORS", "MIXED"];
const EXPERIENCE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const GENDERS = ["MALE", "FEMALE"];
const SOCIAL_STATUSES = ["OPEN_TO_MEET", "IN_RELATIONSHIP", "SINGLE"];

const OPENERS = [
  "¡Hola! Vi que entrenamos en horarios parecidos, ¿te animas a un entreno juntos?",
  "¿Qué rutina llevas para hipertrofia? Ando buscando ideas nuevas.",
  "¡Hola! ¿Sigues yendo temprano al gym? Casi nunca hay nadie a esa hora.",
  "Vi tu objetivo en el directorio, ¡vamos por lo mismo!",
  "¿Recomiendas algún ejercicio para hombro? Me está costando progresar.",
];
const REPLIES = [
  "¡Hola! Sí, claro, cuando quieras.",
  "Depende del día, pero normalmente sí.",
  "Buena pregunta, dejame pensarlo y te cuento.",
  "¡Genial! Coordinemos por acá entonces.",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main(): Promise<void> {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error("SEED_DATABASE_URL environment variable is required.");
  }
  const anchorUserId = process.argv[2];
  if (!anchorUserId) {
    throw new Error("Usage: seed-demo-community.ts <anchorUserId>");
  }

  // Neon's certificates chain to a public CA (Amazon Trust Services), so the
  // default Node TLS trust store verifies them — no need to (and this must
  // never) disable certificate verification. Only set `ssl: true` when the
  // connection string actually asks for TLS: a plain local Postgres (no
  // `sslmode`) doesn't speak TLS at all, and forcing it here would just fail
  // the handshake instead of skipping it.
  const wantsSsl = /sslmode=require|sslmode=verify/.test(connectionString);
  const sequelize = new Sequelize(connectionString, {
    dialect: "postgres",
    models: databaseModels,
    logging: false,
    ...(wantsSsl ? { dialectOptions: { ssl: true } } : {}),
  });

  try {
    await sequelize.authenticate();
    logger.log("connected");

    const anchor = await sequelize.query<{ id: string }>(
      `SELECT id FROM public.usuarios WHERE id = :id`,
      { type: QueryTypes.SELECT, replacements: { id: anchorUserId } },
    );
    if (anchor.length === 0) {
      throw new Error(`Anchor user ${anchorUserId} not found in this database.`);
    }

    const [{ count }] = await sequelize.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.usuarios WHERE email LIKE :pattern`,
      { type: QueryTypes.SELECT, replacements: { pattern: `%${DEMO_EMAIL_DOMAIN}` } },
    );
    if (count >= CACHE_THRESHOLD) {
      logger.log(`cache hit: ${count} demo users already exist, skipping generation`);
      return;
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const demoUserIds: string[] = [];

    await sequelize.transaction(async (transaction) => {
      await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:lockName))", {
        replacements: { lockName: "gym_sheet_demo_community_seed" },
        transaction,
      });

      // El catálogo de niveles/insignias es producto, no datos de prueba —
      // sin él, cada `user_progress` de aquí abajo apuntaría a un `level_code`
      // que no existe en ningún lado.
      await seedProgression(transaction);

      // randomuser.me's portrait sets are gender-labeled (0-99 per set), unlike
      // pravatar.cc's arbitrary faces — a "MALE" card must not show a woman's
      // photo, or the demo reads as broken rather than as sample data.
      let menPhotoIndex = 0;
      let womenPhotoIndex = 0;

      for (let i = 0; i < DEMO_USER_COUNT; i += 1) {
        const userId = randomUUID();
        const gender = pick(GENDERS);
        const fullName = faker.person.fullName({ sex: gender === "FEMALE" ? "female" : "male" });
        const email = `${faker.internet.username().toLowerCase().replace(/[^a-z0-9._-]/g, "")}.${i}${DEMO_EMAIL_DOMAIN}`;
        const goal = pick(GOALS);
        const location = pick(LOCATIONS);
        const photoIndex = gender === "FEMALE" ? womenPhotoIndex++ : menPhotoIndex++;
        const photoUrl = `https://randomuser.me/api/portraits/${gender === "FEMALE" ? "women" : "men"}/${photoIndex}.jpg`;

        await sequelize.query(
          `INSERT INTO public.usuarios
             (id, email, password_hash, nombre_completo, rol, estado, tenant_id, genero, fecha_registro, accepted_terms_at, terms_version)
           VALUES
             (:id, :email, :hash, :name, 'CLIENTE', 'ACTIVO', :tenant, :gender, now(), now(), '1')`,
          {
            transaction,
            replacements: { id: userId, email, hash: passwordHash, name: fullName, tenant: TENANT_ID, gender },
          },
        );

        await sequelize.query(
          `INSERT INTO public.perfiles_antropometricos (id, usuario_id, edad, peso_kg, estatura_cm, objetivo, fecha_actualizacion)
           VALUES (:id, :userId, :edad, :peso, :estatura, :objetivo, now())`,
          {
            transaction,
            replacements: {
              id: randomUUID(),
              userId,
              edad: faker.number.int({ min: 19, max: 45 }),
              peso: faker.number.float({ min: 55, max: 95, fractionDigits: 1 }),
              estatura: faker.number.int({ min: 155, max: 195 }),
              objetivo: goal,
            },
          },
        );

        const experienceLevel = pick(EXPERIENCE_LEVELS);
        await sequelize.query(
          `INSERT INTO profile.onboarding
             (user_id, status, current_step, completed_steps, version, training_location, experience_level,
              weight_unit, height_unit, consent_health, consent_data, started_at, completed_at)
           VALUES
             (:userId, 'COMPLETED', 4, :steps, 1, :location, :experienceLevel, 'KG', 'CM', true, true, now(), now())`,
          {
            transaction,
            replacements: {
              userId,
              steps: JSON.stringify([1, 2, 3, 4]),
              location,
              experienceLevel,
            },
          },
        );

        await sequelize.query(
          `INSERT INTO profile.photos (id, user_id, url, storage_provider, storage_key, position, created_at)
           VALUES (:id, :userId, :url, 'external', :url, 0, now())`,
          {
            transaction,
            replacements: {
              id: randomUUID(),
              userId,
              url: photoUrl,
            },
          },
        );

        // ~60% opt into a visible social status, matching real-world usage.
        if (Math.random() < 0.6) {
          await sequelize.query(
            `INSERT INTO social.profile_settings (user_id, social_status, visible, updated_at)
             VALUES (:userId, :status, true, now())`,
            { transaction, replacements: { userId, status: pick(SOCIAL_STATUSES) } },
          );
        }

        const points = faker.number.int({ min: 0, max: 4000 });
        const [level] = await sequelize.query<{ code: string }>(
          `SELECT code FROM progression.levels
            WHERE tenant_id IS NULL AND audience IN ('ANY', :audience) AND min_points <= :points
            ORDER BY (audience = :audience) DESC, min_points DESC
            LIMIT 1`,
          { type: QueryTypes.SELECT, transaction, replacements: { audience: gender, points } },
        );
        const longestStreak = faker.number.int({ min: 0, max: 45 });
        const currentStreak = faker.number.int({ min: 0, max: longestStreak });
        await sequelize.query(
          `INSERT INTO progression.user_progress
             (usuario_id, points, level_code, current_streak_days, longest_streak_days, total_sessions, total_sets, total_volume_kg, recomputed_at)
           VALUES
             (:userId, :points, :levelCode, :currentStreak, :longestStreak, :sessions, :sets, :volume, now())`,
          {
            transaction,
            replacements: {
              userId,
              points,
              levelCode: level?.code ?? null,
              currentStreak,
              longestStreak,
              sessions: faker.number.int({ min: 0, max: 120 }),
              sets: faker.number.int({ min: 0, max: 900 }),
              volume: faker.number.int({ min: 0, max: 50000 }),
            },
          },
        );

        demoUserIds.push(userId);
      }

      // Da a la cuenta ancla un lugar real en la tabla de posiciones, no solo
      // el rol de espectador — si no, siempre aparecería última.
      const anchorPoints = faker.number.int({ min: 500, max: 3000 });
      const [anchorLevel] = await sequelize.query<{ code: string }>(
        `SELECT code FROM progression.levels
          WHERE tenant_id IS NULL AND audience = 'ANY' AND min_points <= :points
          ORDER BY min_points DESC LIMIT 1`,
        { type: QueryTypes.SELECT, transaction, replacements: { points: anchorPoints } },
      );
      const anchorLongestStreak = faker.number.int({ min: 5, max: 30 });
      const anchorCurrentStreak = faker.number.int({ min: 0, max: anchorLongestStreak });
      await sequelize.query(
        `INSERT INTO progression.user_progress
           (usuario_id, points, level_code, current_streak_days, longest_streak_days, total_sessions, total_sets, total_volume_kg, recomputed_at)
         VALUES (:userId, :points, :levelCode, :currentStreak, :longestStreak, 20, 150, 8000, now())
         ON CONFLICT (usuario_id) DO UPDATE SET points = EXCLUDED.points, level_code = EXCLUDED.level_code`,
        {
          transaction,
          replacements: {
            userId: anchorUserId,
            points: anchorPoints,
            levelCode: anchorLevel?.code ?? null,
            currentStreak: anchorCurrentStreak,
            longestStreak: anchorLongestStreak,
          },
        },
      );

      // --- Connections with the anchor account, one of each state ---
      const withAnchor = async (
        otherUserId: string,
        requesterId: string,
        addresseeId: string,
        status: "PENDING" | "ACCEPTED",
      ) => {
        await sequelize.query(
          `INSERT INTO social.connections (id, requester_id, addressee_id, status, responded_at, created_at, updated_at)
           VALUES (:id, :requesterId, :addresseeId, :status, :respondedAt, now(), now())`,
          {
            transaction,
            replacements: {
              id: randomUUID(),
              requesterId,
              addresseeId,
              status,
              respondedAt: status === "ACCEPTED" ? new Date() : null,
            },
          },
        );
      };

      const seedConversation = async (userA: string, userB: string) => {
        const conversationId = randomUUID();
        await sequelize.query(`INSERT INTO chat.conversations (id, created_at) VALUES (:id, now())`, {
          transaction,
          replacements: { id: conversationId },
        });
        await sequelize.query(
          `INSERT INTO chat.participants (conversation_id, user_id, joined_at) VALUES (:id, :a, now()), (:id, :b, now())`,
          { transaction, replacements: { id: conversationId, a: userA, b: userB } },
        );
        const exchange = [
          { sender: userB, body: pick(OPENERS) },
          { sender: userA, body: pick(REPLIES) },
          { sender: userB, body: pick(REPLIES) },
        ];
        for (const message of exchange) {
          await sequelize.query(
            `INSERT INTO chat.messages (id, conversation_id, sender_id, body, created_at) VALUES (:id, :conv, :sender, :body, now())`,
            {
              transaction,
              replacements: { id: randomUUID(), conv: conversationId, sender: message.sender, body: message.body },
            },
          );
        }
      };

      // 2 accepted, with real conversations
      await withAnchor(demoUserIds[0], demoUserIds[0], anchorUserId, "ACCEPTED");
      await seedConversation(anchorUserId, demoUserIds[0]);
      await withAnchor(demoUserIds[1], demoUserIds[1], anchorUserId, "ACCEPTED");
      await seedConversation(anchorUserId, demoUserIds[1]);

      // 2 pending received (fake -> anchor): show up under "Te escribieron"
      await withAnchor(demoUserIds[2], demoUserIds[2], anchorUserId, "PENDING");
      await withAnchor(demoUserIds[3], demoUserIds[3], anchorUserId, "PENDING");

      // 1 pending sent (anchor -> fake): shows up under "Enviadas"
      await withAnchor(demoUserIds[4], anchorUserId, demoUserIds[4], "PENDING");

      // Remaining demo users (5..9) stay NONE — just visible in the directory.

      // A couple of connections between demo users themselves, for directory
      // richness beyond the anchor's own relationships.
      await withAnchor(demoUserIds[5], demoUserIds[5], demoUserIds[6], "ACCEPTED");
      await withAnchor(demoUserIds[7], demoUserIds[8], demoUserIds[7], "PENDING");
    });

    logger.log(`done: created ${demoUserIds.length} demo users around anchor ${anchorUserId}`);
  } finally {
    await sequelize.close();
  }
}

main().catch((error: unknown) => {
  logger.error("seed-demo-community failed:", error);
  process.exitCode = 1;
});
