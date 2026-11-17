import { config as loadEnvironmentFile } from "dotenv";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { DEFAULT_RANKING_CONFIG } from "./discovery-ranking.config";
import { DiscoveryRankingRepository, type RankingQuery } from "./discovery-ranking.repository";
import type { DiscoveryPreferences } from "./social.repository";

/**
 * Runs the real ranking SQL against PostgreSQL inside BEGIN … ROLLBACK (one
 * pooled connection, same pattern as stories.repository.integration.spec.ts).
 * Needs a migrated database; skip deliberately with SKIP_DB_INTEGRATION_TESTS=1.
 */
loadEnvironmentFile();
const db = z
  .object({
    DB_HOST: z.string().default("localhost"),
    DB_PORT: z.coerce.number().int().default(5433),
    DB_NAME: z.string().default("gym_sheet"),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
  })
  .parse(process.env);
const skipRequested = process.env.SKIP_DB_INTEGRATION_TESTS === "1";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const viewerId = "22222222-0000-4000-8000-000000000001";
const branchHome = "22222222-0000-4000-8000-0000000000b1";
const branchNear = "22222222-0000-4000-8000-0000000000b2"; // ~2.2 km north
const branchMid = "22222222-0000-4000-8000-0000000000b3"; // ~8.9 km north
const branchFar = "22222222-0000-4000-8000-0000000000b4"; // ~55 km north
const id = (n: number) => `22222222-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;

let sequelize: Sequelize;
let repository: DiscoveryRankingRepository;
let unavailable = false;

const raw = (sql: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query(sql, { type: QueryTypes.RAW, replacements });

interface Member {
  id: string;
  gender?: "MALE" | "FEMALE";
  ageYears?: number;
  branchId?: string;
  lastActiveAgo?: number;
  createdAgo?: number;
  verified?: boolean;
  emailVerified?: boolean;
  photos?: number;
  prefers?: ("MALE" | "FEMALE")[];
  prefMin?: number;
  prefMax?: number;
  intents?: string[];
  goal?: string;
}

async function insertMember(member: Member): Promise<void> {
  const now = Date.now();
  await raw(
    `INSERT INTO usuarios (id, email, password_hash, nombre_completo, genero, fecha_nacimiento,
                           sede_id, last_active_at, created_at, verified_at, email_verified_at)
     VALUES (:id, :email, 'x', :name, :gender, (now() - make_interval(years => :age))::date - 1,
             :branchId, :lastActive, :createdAt, :verifiedAt, :emailVerifiedAt)`,
    {
      id: member.id,
      email: `ranking-it-${member.id}@example.test`,
      name: `Member ${member.id.slice(-4)}`,
      gender: member.gender ?? "FEMALE",
      age: member.ageYears ?? 28,
      branchId: member.branchId ?? branchNear,
      lastActive: new Date(now - (member.lastActiveAgo ?? HOUR)),
      createdAt: new Date(now - (member.createdAgo ?? 60 * DAY)),
      verifiedAt: member.verified ? new Date(now - DAY) : null,
      emailVerifiedAt: member.emailVerified === false ? null : new Date(now - DAY),
    },
  );
  await raw(`INSERT INTO social.profile_settings (user_id, profile_enabled) VALUES (:id, true)`, { id: member.id });
  await raw(
    `INSERT INTO social.discovery_preferences
       (user_id, genders, intents, min_age, max_age, radius_km, flexible_age, flexible_distance)
     VALUES (:id, ARRAY[:genders]::text[], ARRAY[:intents]::text[], :min, :max, 50, false, false)`,
    {
      id: member.id,
      genders: member.prefers ?? ["MALE"],
      intents: member.intents ?? ["TRAINING"],
      min: member.prefMin ?? 18,
      max: member.prefMax ?? 60,
    },
  );
  if (member.goal) {
    await raw(
      `INSERT INTO perfiles_antropometricos (usuario_id, peso_kg, estatura_cm, objetivo) VALUES (:id, 70, 170, :goal)`,
      { id: member.id, goal: member.goal },
    );
  }
  for (let position = 0; position < (member.photos ?? 2); position += 1) {
    await raw(
      `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key, position)
       VALUES (:id, 'http://localhost/p.jpg', 'local', :key, :position)`,
      { id: member.id, key: `ranking-it/${member.id}/${position}`, position },
    );
  }
}

const preferences = (overrides: Partial<DiscoveryPreferences> = {}): DiscoveryPreferences => ({
  configured: true,
  genders: ["FEMALE"],
  intents: ["TRAINING"],
  minAge: 20,
  maxAge: 40,
  radiusKm: 10,
  flexibleAge: false,
  flexibleDistance: false,
  version: 1,
  ...overrides,
});

const rank = (overrides: Partial<RankingQuery> = {}) =>
  repository.rank({
    viewerId,
    tenantId: "default",
    includeCrossGym: false,
    preferences: preferences(),
    filters: {},
    config: DEFAULT_RANKING_CONFIG,
    asOf: new Date(),
    globalLikeRate: 0.3,
    rowLimit: 50,
    key: null,
    forcedIds: [],
    excludedIds: [],
    ...overrides,
  });
const ids = async (overrides: Partial<RankingQuery> = {}) => (await rank(overrides)).map((row) => row.id);

beforeAll(async () => {
  sequelize = new Sequelize({
    dialect: "postgres",
    host: db.DB_HOST,
    port: db.DB_PORT,
    database: db.DB_NAME,
    username: db.DB_USER,
    password: db.DB_PASSWORD,
    logging: false,
    pool: { max: 1, min: 1, acquire: 10000, idle: 1000 },
    models: [],
  });
  try {
    await sequelize.query("SELECT 1 FROM social.ranking_config LIMIT 1", { type: QueryTypes.SELECT });
  } catch (error) {
    unavailable = true;
    if (!skipRequested) {
      throw new Error(
        `No migrated PostgreSQL at ${db.DB_HOST}:${db.DB_PORT}/${db.DB_NAME} (${String(error)}). ` +
          "Run `yarn migration:up` or skip deliberately with SKIP_DB_INTEGRATION_TESTS=1.",
      );
    }
  }
  repository = new DiscoveryRankingRepository(sequelize);
}, 30000);

afterAll(async () => {
  await sequelize?.close();
});

beforeEach(async () => {
  if (unavailable) return;
  await raw("BEGIN");
  const branches: [string, number][] = [
    [branchHome, -17.78],
    [branchNear, -17.76],
    [branchMid, -17.7],
    [branchFar, -17.28],
  ];
  for (const [branchId, latitude] of branches) {
    await raw(
      `INSERT INTO facilities.branches (id, code, name, time_zone, latitude, longitude)
       VALUES (:branchId, :code, :code, 'America/La_Paz', :latitude, -63.18)`,
      { branchId, code: `ranking-it-${branchId.slice(-2)}`, latitude },
    );
  }
  await insertMember({ id: viewerId, gender: "MALE", ageYears: 30, branchId: branchHome, prefers: ["FEMALE"] });
});

afterEach(async () => {
  if (!unavailable) await raw("ROLLBACK");
});

const maybe = skipRequested ? it.skip : it;

describe("discovery ranking SQL (PostgreSQL)", () => {
  maybe("applies every hard filter before scoring", async () => {
    await insertMember({ id: id(1) }); // eligible control
    await insertMember({ id: id(2), branchId: branchFar }); // outside radius
    await insertMember({ id: id(3), prefers: ["FEMALE"] }); // does not want the viewer
    await insertMember({ id: id(4), prefMax: 25 }); // viewer (30) is too old for her
    await insertMember({ id: id(5), emailVerified: false });
    await insertMember({ id: id(6), photos: 1 });
    await insertMember({ id: id(7), ageYears: 17 });
    await insertMember({ id: id(8), gender: "MALE", prefers: ["MALE"] });
    await insertMember({ id: id(9) });
    await insertMember({ id: id(10) });
    await raw(`INSERT INTO social.user_blocks (blocker_id, blocked_id) VALUES (:a, :b)`, { a: id(9), b: viewerId });
    await raw(`INSERT INTO social.discovery_passes (viewer_id, target_id) VALUES (:a, :b)`, { a: viewerId, b: id(10) });
    await insertMember({ id: id(11) }); // the viewer already liked her
    await insertMember({ id: id(12) }); // a rejected request is a decision too
    await raw(`INSERT INTO social.connections (requester_id, addressee_id) VALUES (:a, :b)`, { a: viewerId, b: id(11) });
    await raw(`INSERT INTO social.connections (requester_id, addressee_id, status) VALUES (:a, :b, 'REJECTED')`, {
      a: id(12),
      b: viewerId,
    });
    expect(await ids()).toEqual([id(1)]);
  });

  maybe("flexible distance admits up to 1.5x the radius with a negative distance factor", async () => {
    await insertMember({ id: id(1), branchId: branchMid });
    expect(await ids({ preferences: preferences({ radiusKm: 7 }) })).toEqual([]);
    const [row] = await rank({ preferences: preferences({ radiusKm: 7, flexibleDistance: true }) });
    expect(row.id).toBe(id(1));
    expect(row.distance).toBeLessThan(0);
    expect(row.distanceKm).toBe(9);
  });

  maybe("ranks a verified member above an otherwise equal unverified one", async () => {
    await insertMember({ id: id(1) });
    await insertMember({ id: id(2), verified: true });
    const rows = await rank();
    expect(rows.map((row) => row.id)).toEqual([id(2), id(1)]);
    expect(rows[0].verification).toBe(1);
    expect(rows[0].reasons).toContain("VERIFIED");
  });

  maybe("ranks the nearer member first and reports whole kilometres", async () => {
    await insertMember({ id: id(1), branchId: branchMid });
    await insertMember({ id: id(2), branchId: branchNear });
    const rows = await rank();
    expect(rows.map((row) => row.id)).toEqual([id(2), id(1)]);
    expect(rows[0].distanceKm).toBe(2);
    expect(rows[0].reasons).toContain("NEARBY");
    expect(rows[0].distance).toBeCloseTo(1 - 2.22 / 10, 1);
  });

  maybe("sinks a member inactive for 30 days and lifts one training now", async () => {
    await insertMember({ id: id(1), lastActiveAgo: 30 * DAY });
    await insertMember({ id: id(2), lastActiveAgo: 5 * HOUR });
    await insertMember({ id: id(3), lastActiveAgo: 2 * DAY });
    await raw(`INSERT INTO sesiones_entrenamiento (usuario_id, fecha_inicio) VALUES (:id, now() - interval '20 minutes')`, {
      id: id(3),
    });
    const rows = await rank();
    expect(rows.map((row) => row.id)).toEqual([id(3), id(2), id(1)]);
    expect(rows[0].activity).toBe(1);
    // Training now lifts the card but is never disclosed (real-time presence).
    expect(rows[0].reasons).not.toContain("TRAINING_NOW");
    expect(rows[0].reasons).not.toContain("ACTIVE_NOW");
    expect(rows[2].activity).toBeLessThan(0.001);
  });

  maybe("scores mutual likelihood, intent, affinity and novelty", async () => {
    await insertMember({ id: id(1), intents: ["UNSURE"] });
    await insertMember({ id: id(2), intents: ["TRAINING", "FRIENDSHIP"], goal: "FUERZA", createdAgo: DAY });
    await insertMember({ id: id(3) });
    await raw(`INSERT INTO perfiles_antropometricos (usuario_id, peso_kg, estatura_cm, objetivo) VALUES (:id, 80, 180, 'FUERZA')`, {
      id: viewerId,
    });
    await raw(`INSERT INTO social.connections (requester_id, addressee_id) VALUES (:a, :b)`, { a: id(3), b: viewerId });
    const byId = new Map((await rank()).map((row) => [row.id, row]));
    expect(byId.get(id(1))?.intent).toBe(0.5);
    expect(byId.get(id(2))?.intent).toBe(0.5);
    expect(byId.get(id(2))?.novelty).toBe(1);
    expect(byId.get(id(2))?.reasons).toEqual(expect.arrayContaining(["SAME_GOAL", "NEW_HERE"]));
    expect(byId.get(id(2))?.isNew).toBe(true);
    expect(byId.get(id(3))?.mutual).toBe(1);
    expect(byId.get(id(3))?.likedViewer).toBe(true);
    // Smoothed toward the global rate when the candidate has no history.
    expect(byId.get(id(1))?.mutual).toBeCloseTo(0.3, 5);
  });

  maybe("pages with a stable (score, id) keyset inside one snapshot", async () => {
    for (let n = 1; n <= 6; n += 1) await insertMember({ id: id(n), lastActiveAgo: n * HOUR });
    const asOf = new Date();
    const all = await rank({ asOf });
    const first = all.slice(0, 3);
    const rest = await rank({ asOf, key: { score: first[2].score, id: first[2].id } });
    expect([...first, ...rest].map((row) => row.id)).toEqual(all.map((row) => row.id));
  });
});
