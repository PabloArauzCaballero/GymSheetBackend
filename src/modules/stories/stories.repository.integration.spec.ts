import { config as loadEnvironmentFile } from "dotenv";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { StoryModel } from "./story.model";
import { StoryViewModel } from "./story-view.model";
import {
  STORY_FEED_MAX_AUTHORS,
  STORY_FEED_MAX_STORIES_PER_AUTHOR,
  StoriesRepository,
  StoryFeedRow,
} from "./stories.repository";

/**
 * Pruebas de integración del SQL de stories: **ejecutan la consulta real contra
 * PostgreSQL**. Existen porque las de `stories.repository.spec.ts` comparaban
 * subcadenas del texto de la consulta, y eso no protege nada: quitar los
 * paréntesis que agrupan el filtro de visibilidad convertía el feed en una fuga
 * de stories entre gimnasios (4 filas donde debía haber 2) con los 29 tests en
 * verde, y borrar la clave de desempate del `ORDER BY` tampoco rompía ninguno.
 *
 * Aislamiento: cada prueba corre dentro de `BEGIN … ROLLBACK`, de modo que los
 * datos sembrados de la base de desarrollo no se tocan. El `pool` es de **una**
 * conexión a propósito: así todas las consultas de una prueba (las del fixture y
 * las del repositorio, que no reciben `Transaction`) caen en la misma sesión y
 * la transacción las cubre a todas.
 *
 * Ejecución: corren con `yarn test` como cualquier otra spec, y necesitan el
 * PostgreSQL de desarrollo levantado (`docker compose up -d postgres`, :5433 con
 * el esquema migrado). Si no hay base, la suite **falla con instrucciones** en
 * vez de pasar en silencio; para saltarla deliberadamente (por ejemplo en un
 * paso de CI que aún no ha creado el esquema) hay que pedirlo explícitamente con
 * `SKIP_DB_INTEGRATION_TESTS=1`.
 */
loadEnvironmentFile();

const databaseEnvironmentSchema = z.object({
  DB_HOST: z.string().trim().min(1).default("localhost"),
  DB_PORT: z.coerce.number().int().positive().max(65535).default(5433),
  DB_NAME: z.string().trim().min(1).default("gym_sheet"),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string().min(1),
});
const databaseEnvironment = databaseEnvironmentSchema.parse(process.env);

const skipRequested = process.env.SKIP_DB_INTEGRATION_TESTS === "1";

const tenant = "topfitness";
const otherTenant = "megatlon";
const viewerId = "11111111-0000-4000-8000-000000000001";
const matchId = "11111111-0000-4000-8000-000000000002";
const otherMatchId = "11111111-0000-4000-8000-000000000003";
const strangerId = "11111111-0000-4000-8000-000000000004";
const pendingId = "11111111-0000-4000-8000-000000000005";
const rejectedId = "11111111-0000-4000-8000-000000000006";
const foreignId = "11111111-0000-4000-8000-000000000007";

let sequelize: Sequelize;
let repository: StoriesRepository;
let unavailable = false;

async function raw(sql: string, replacements: Record<string, unknown> = {}): Promise<void> {
  await sequelize.query(sql, { type: QueryTypes.RAW, replacements });
}

/** Un socio del gimnasio indicado. El email es único por id para no chocar. */
async function insertUser(id: string, fullName: string, tenantId = tenant): Promise<void> {
  await raw(
    `INSERT INTO usuarios (id, email, password_hash, nombre_completo, rol, estado, tenant_id)
     VALUES (:id, :email, 'not-used', :fullName, 'CLIENTE', 'ACTIVO', :tenantId)`,
    { id, email: `stories-it-${id}@example.test`, fullName, tenantId },
  );
}

async function insertConnection(
  requesterId: string,
  addresseeId: string,
  status: ConnectionStatus,
): Promise<void> {
  await raw(
    `INSERT INTO social.connections (requester_id, addressee_id, status)
     VALUES (:requesterId, :addresseeId, :status)`,
    { requesterId, addresseeId, status },
  );
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Instantes relativos al reloj del proceso: nada de expresiones SQL en los fixtures. */
function ago(milliseconds: number): Date {
  return new Date(Date.now() - milliseconds);
}
function ahead(milliseconds: number): Date {
  return new Date(Date.now() + milliseconds);
}

interface StorySeed {
  id: string;
  userId: string;
  createdAt: Date;
  /** Por omisión vigente; se pasa en el pasado para probar la caducidad. */
  expiresAt?: Date;
  tenantId?: string;
}

async function insertStory(seed: StorySeed): Promise<void> {
  await raw(
    `INSERT INTO profile.stories
       (id, user_id, tenant_id, media_url, storage_provider, storage_key, media_type, created_at, expires_at)
     VALUES (:id, :userId, :tenantId, :mediaUrl, 'local', :storageKey, 'image', :createdAt, :expiresAt)`,
    {
      id: seed.id,
      userId: seed.userId,
      tenantId: seed.tenantId ?? tenant,
      mediaUrl: `http://localhost:3000/media/stories/${seed.id}.jpg`,
      storageKey: `stories/${seed.id}.jpg`,
      createdAt: seed.createdAt,
      expiresAt: seed.expiresAt ?? ahead(6 * HOUR_MS),
    },
  );
}

async function insertView(storyId: string, viewerUserId: string): Promise<void> {
  await raw(
    `INSERT INTO profile.story_views (story_id, viewer_id, viewed_at)
     VALUES (:storyId, :viewerId, now())`,
    { storyId, viewerId: viewerUserId },
  );
}

function authorsOf(rows: StoryFeedRow[]): string[] {
  return rows.map((row) => row.user_id);
}

beforeAll(async () => {
  sequelize = new Sequelize({
    dialect: "postgres",
    host: databaseEnvironment.DB_HOST,
    port: databaseEnvironment.DB_PORT,
    database: databaseEnvironment.DB_NAME,
    username: databaseEnvironment.DB_USER,
    password: databaseEnvironment.DB_PASSWORD,
    logging: false,
    // Una sola conexión: la transacción de la prueba cubre todas las consultas.
    pool: { max: 1, min: 1, acquire: 10000, idle: 1000 },
    models: [],
  });

  try {
    await sequelize.authenticate();
    await sequelize.query("SELECT 1 FROM profile.stories LIMIT 1", { type: QueryTypes.SELECT });
  } catch (error) {
    unavailable = true;
    const detail = error instanceof Error ? error.message : String(error);
    if (!skipRequested) {
      throw new Error(
        `No hay PostgreSQL con el esquema migrado en ${databaseEnvironment.DB_HOST}:${databaseEnvironment.DB_PORT}/${databaseEnvironment.DB_NAME} (${detail}). ` +
          "Estas pruebas ejecutan SQL real: levanta la base (`docker compose up -d postgres` + `yarn migration:up`) " +
          "o sáltalas deliberadamente con SKIP_DB_INTEGRATION_TESTS=1.",
      );
    }
    console.warn("stories integration specs skipped: SKIP_DB_INTEGRATION_TESTS=1");
  }

  repository = new StoriesRepository(
    sequelize,
    {} as unknown as typeof StoryModel,
    {} as unknown as typeof StoryViewModel,
  );
}, 30000);

afterAll(async () => {
  await sequelize?.close();
});

beforeEach(async () => {
  if (unavailable) return;
  await raw("BEGIN");
  await insertUser(viewerId, "Viewer");
});

afterEach(async () => {
  if (unavailable) return;
  // Nada de lo insertado sobrevive: la base de desarrollo queda intacta.
  await raw("ROLLBACK");
});

describe("StoriesRepository.feedForConnections (SQL real)", () => {
  it("leaves out strangers, PENDING and REJECTED connections", async () => {
    if (unavailable) return;
    await insertUser(strangerId, "Desconocida");
    await insertUser(pendingId, "Pendiente");
    await insertUser(rejectedId, "Rechazado");
    await insertConnection(pendingId, viewerId, ConnectionStatus.PENDING);
    await insertConnection(rejectedId, viewerId, ConnectionStatus.REJECTED);
    await insertStory({ id: "22222222-0000-4000-8000-000000000001", userId: strangerId, createdAt: ago(HOUR_MS) });
    await insertStory({ id: "22222222-0000-4000-8000-000000000002", userId: pendingId, createdAt: ago(HOUR_MS) });
    await insertStory({ id: "22222222-0000-4000-8000-000000000003", userId: rejectedId, createdAt: ago(HOUR_MS) });

    await expect(repository.feedForConnections(viewerId, tenant)).resolves.toEqual([]);
  });

  it("leaves out another gym even with an accepted connection", async () => {
    if (unavailable) return;
    await insertUser(foreignId, "Match de otro gimnasio", otherTenant);
    await insertConnection(viewerId, foreignId, ConnectionStatus.ACCEPTED);
    await insertStory({
      id: "22222222-0000-4000-8000-000000000004",
      userId: foreignId,
      createdAt: ago(HOUR_MS),
      tenantId: otherTenant,
    });

    await expect(repository.feedForConnections(viewerId, tenant)).resolves.toEqual([]);
  });

  it("leaves out an expired story of a match", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Match");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await insertStory({
      id: "22222222-0000-4000-8000-000000000005",
      userId: matchId,
      createdAt: ago(30 * HOUR_MS),
      expiresAt: ago(6 * HOUR_MS),
    });
    await insertStory({ id: "22222222-0000-4000-8000-000000000006", userId: matchId, createdAt: ago(HOUR_MS) });

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(rows.map((row) => row.id)).toEqual(["22222222-0000-4000-8000-000000000006"]);
  });

  it("puts the viewer's own stories first even when already seen", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Match");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    // El match publicó después y sin ver; las propias mandan igualmente.
    await insertStory({ id: "22222222-0000-4000-8000-000000000007", userId: matchId, createdAt: ago(10 * MINUTE_MS) });
    await insertStory({ id: "22222222-0000-4000-8000-000000000008", userId: viewerId, createdAt: ago(5 * HOUR_MS) });
    await insertStory({ id: "22222222-0000-4000-8000-000000000009", userId: viewerId, createdAt: ago(2 * HOUR_MS) });
    await insertView("22222222-0000-4000-8000-000000000008", viewerId);
    await insertView("22222222-0000-4000-8000-000000000009", viewerId);

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(authorsOf(rows)).toEqual([viewerId, viewerId, matchId]);
    // Dentro de una persona, cronológico ascendente: se ven como se publicaron.
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual([
      "22222222-0000-4000-8000-000000000008",
      "22222222-0000-4000-8000-000000000009",
    ]);
  });

  it("ranks the match with unseen content above the one already seen in full", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Sin ver");
    await insertUser(otherMatchId, "Visto");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await insertConnection(otherMatchId, viewerId, ConnectionStatus.ACCEPTED);
    // El ya visto publicó lo más reciente; el sin ver gana igualmente.
    await insertStory({ id: "22222222-0000-4000-8000-00000000000a", userId: otherMatchId, createdAt: ago(5 * MINUTE_MS) });
    await insertStory({ id: "22222222-0000-4000-8000-00000000000b", userId: matchId, createdAt: ago(3 * HOUR_MS) });
    await insertView("22222222-0000-4000-8000-00000000000a", viewerId);

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(authorsOf(rows)).toEqual([matchId, otherMatchId]);
    expect(rows.map((row) => row.viewed_by_me)).toEqual([false, true]);
  });

  it("keeps each author's rows contiguous when two share the exact same max(created_at)", async () => {
    if (unavailable) return;
    // El caso que la clave de desempate `s.user_id` existe para resolver: sin
    // ella las cuatro filas se ordenan solo por `created_at` y las dos personas
    // se intercalan, lo que rompe la agrupación del mapper (una persona
    // aparecería dos veces en el feed).
    await insertUser(matchId, "Match A");
    await insertUser(otherMatchId, "Match B");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await insertConnection(viewerId, otherMatchId, ConnectionStatus.ACCEPTED);
    const older = new Date("2026-09-11T10:00:00.000Z");
    const newer = new Date("2026-09-11T12:00:00.000Z");
    await insertStory({ id: "22222222-0000-4000-8000-00000000000c", userId: matchId, createdAt: older });
    await insertStory({ id: "22222222-0000-4000-8000-00000000000d", userId: otherMatchId, createdAt: older });
    await insertStory({ id: "22222222-0000-4000-8000-00000000000e", userId: matchId, createdAt: newer });
    await insertStory({ id: "22222222-0000-4000-8000-00000000000f", userId: otherMatchId, createdAt: newer });

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(rows).toHaveLength(4);
    const authors = authorsOf(rows);
    expect(new Set(authors).size).toBe(2);
    // Contiguas: el primer y el segundo autor no se alternan.
    expect(authors[0]).toBe(authors[1]);
    expect(authors[2]).toBe(authors[3]);
    expect(authors[0]).not.toBe(authors[2]);
  });

  it("returns created_at as a Date, which is what the driver actually yields", async () => {
    if (unavailable) return;
    await insertStory({ id: "22222222-0000-4000-8000-000000000010", userId: viewerId, createdAt: ago(HOUR_MS) });

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(rows[0].expires_at).toBeInstanceOf(Date);
  });

  it("caps the stories returned per author", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Match prolífico");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await raw(
      `INSERT INTO profile.stories
         (user_id, tenant_id, media_url, storage_provider, storage_key, media_type, created_at, expires_at)
       SELECT :userId, :tenantId, 'http://localhost:3000/media/stories/bulk-' || g || '.jpg',
              'local', 'stories/bulk-' || g || '.jpg', 'image',
              now() - (g * interval '5 minutes'), now() + interval '6 hours'
         FROM generate_series(1, :count) g`,
      { userId: matchId, tenantId: tenant, count: STORY_FEED_MAX_STORIES_PER_AUTHOR + 5 },
    );

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(rows).toHaveLength(STORY_FEED_MAX_STORIES_PER_AUTHOR);
  });

  it("caps the number of people in the feed", async () => {
    if (unavailable) return;
    const extraAuthors = STORY_FEED_MAX_AUTHORS + 5;
    await raw(
      `INSERT INTO usuarios (id, email, password_hash, nombre_completo, rol, estado, tenant_id)
       SELECT ('33333333-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
              'stories-it-bulk-' || g || '@example.test', 'not-used', 'Match ' || g,
              'CLIENTE', 'ACTIVO', :tenantId
         FROM generate_series(1, :count) g`,
      { tenantId: tenant, count: extraAuthors },
    );
    await raw(
      `INSERT INTO social.connections (requester_id, addressee_id, status)
       SELECT :viewerId, ('33333333-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, :status
         FROM generate_series(1, :count) g`,
      { viewerId, status: ConnectionStatus.ACCEPTED, count: extraAuthors },
    );
    await raw(
      `INSERT INTO profile.stories
         (user_id, tenant_id, media_url, storage_provider, storage_key, media_type, created_at, expires_at)
       SELECT ('33333333-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, :tenantId,
              'http://localhost:3000/media/stories/author-' || g || '.jpg',
              'local', 'stories/author-' || g || '.jpg', 'image',
              now() - (g * interval '2 minutes'), now() + interval '6 hours'
         FROM generate_series(1, :count) g`,
      { tenantId: tenant, count: extraAuthors },
    );

    const rows = await repository.feedForConnections(viewerId, tenant);

    expect(new Set(authorsOf(rows)).size).toBe(STORY_FEED_MAX_AUTHORS);
  });
});

describe("StoriesRepository.hasAcceptedConnection (SQL real)", () => {
  it("is true in both directions of an accepted connection", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Match");
    await insertUser(otherMatchId, "Otro match");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await insertConnection(otherMatchId, viewerId, ConnectionStatus.ACCEPTED);

    await expect(repository.hasAcceptedConnection(viewerId, matchId)).resolves.toBe(true);
    await expect(repository.hasAcceptedConnection(viewerId, otherMatchId)).resolves.toBe(true);
  });

  it("is false without a connection, and for PENDING or REJECTED", async () => {
    if (unavailable) return;
    await insertUser(strangerId, "Desconocida");
    await insertUser(pendingId, "Pendiente");
    await insertUser(rejectedId, "Rechazado");
    await insertConnection(pendingId, viewerId, ConnectionStatus.PENDING);
    await insertConnection(rejectedId, viewerId, ConnectionStatus.REJECTED);

    await expect(repository.hasAcceptedConnection(viewerId, strangerId)).resolves.toBe(false);
    await expect(repository.hasAcceptedConnection(viewerId, pendingId)).resolves.toBe(false);
    await expect(repository.hasAcceptedConnection(viewerId, rejectedId)).resolves.toBe(false);
  });
});

describe("StoriesRepository.viewersOf (SQL real)", () => {
  const ownStoryId = "22222222-0000-4000-8000-0000000000a1";

  it("lists matches and the author, never a stranger whose view was recorded earlier", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Match");
    await insertUser(strangerId, "Desconocida");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await insertStory({ id: ownStoryId, userId: viewerId, createdAt: ago(HOUR_MS) });
    await insertView(ownStoryId, matchId);
    // Vista grabada antes del arreglo de `view`: sigue en la tabla y no debe
    // publicar el nombre ni la foto de quien no es match.
    await insertView(ownStoryId, strangerId);

    const viewers = await repository.viewersOf(ownStoryId, tenant);

    expect(viewers.map((viewer) => viewer.user_id)).toEqual([matchId]);
  });

  it("returns nothing for a story of another gym", async () => {
    if (unavailable) return;
    await insertUser(matchId, "Match");
    await insertConnection(viewerId, matchId, ConnectionStatus.ACCEPTED);
    await insertStory({ id: ownStoryId, userId: viewerId, createdAt: ago(HOUR_MS) });
    await insertView(ownStoryId, matchId);

    await expect(repository.viewersOf(ownStoryId, otherTenant)).resolves.toEqual([]);
  });
});
