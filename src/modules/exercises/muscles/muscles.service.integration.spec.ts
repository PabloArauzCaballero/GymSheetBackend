import { NotFoundException } from "@nestjs/common";
import { config as loadEnvironmentFile } from "dotenv";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { MuscleGroupModel } from "./muscle-group.model";
import { MuscleModel } from "./muscle.model";
import { MusclesService } from "./muscles.service";

/**
 * Pruebas de integración de `GET /muscles/:code` y `GET /muscles/:code/exercises`:
 * **ejecutan el SQL real contra PostgreSQL**, porque lo que se quiere proteger es
 * justamente la consulta (el `LATERAL` que elige la lámina, el `COUNT(*) OVER()`
 * del total y el `OFFSET`), y una prueba con la base simulada no vería ninguno.
 *
 * Mismo esquema de aislamiento que `stories.repository.integration.spec.ts`:
 * cada prueba corre dentro de `BEGIN … ROLLBACK` y el pool es de una conexión,
 * así lo que se inserta se deshace y la base de desarrollo queda intacta.
 *
 * Necesitan la base migrada **y enriquecida** (`yarn db:enrich:exercises`): los
 * músculos y sus ejercicios salen de ese proceso, no de una migración. Sin base,
 * la suite falla con instrucciones; para saltarla a propósito hay que pedirlo con
 * `SKIP_DB_INTEGRATION_TESTS=1`.
 */
loadEnvironmentFile();

const databaseEnvironment = z
  .object({
    DB_HOST: z.string().trim().min(1).default("localhost"),
    DB_PORT: z.coerce.number().int().positive().max(65535).default(5433),
    DB_NAME: z.string().trim().min(1).default("gym_sheet"),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
  })
  .parse(process.env);

const skipRequested = process.env.SKIP_DB_INTEGRATION_TESTS === "1";
const CODE = "PECTORALIS_MAJOR";

let sequelize: Sequelize;
let service: MusclesService;
let unavailable = false;

async function raw(
  sql: string,
  replacements: Record<string, unknown> = {},
): Promise<void> {
  await sequelize.query(sql, { type: QueryTypes.RAW, replacements });
}

/** Vacía la media del ejercicio (dentro de la transacción) para sembrar la propia. */
async function clearMedia(exerciseId: string): Promise<void> {
  await raw("DELETE FROM training.exercise_media WHERE ejercicio_id = :exerciseId", {
    exerciseId,
  });
}

async function insertMedia(seed: {
  id: string;
  exerciseId: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
  status?: string;
  mediaType?: string;
}): Promise<void> {
  await raw(
    `INSERT INTO training.exercise_media
       (id, ejercicio_id, media_type, provider, url, alt_text, is_primary, sort_order, status)
     VALUES (:id, :exerciseId, :mediaType, 'LOCAL', :url, 'lámina de prueba',
             :isPrimary, :sortOrder, :status)`,
    {
      id: seed.id,
      exerciseId: seed.exerciseId,
      mediaType: seed.mediaType ?? "IMAGE",
      url: seed.url,
      isPrimary: seed.isPrimary,
      sortOrder: seed.sortOrder,
      status: seed.status ?? "ACTIVE",
    },
  );
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
    pool: { max: 1, min: 1, acquire: 10000, idle: 1000 },
    models: [MuscleGroupModel, MuscleModel],
  });
  try {
    await sequelize.authenticate();
    const [{ total }] = await sequelize.query<{ total: string }>(
      "SELECT count(*) AS total FROM training.exercise_muscles",
      { type: QueryTypes.SELECT },
    );
    if (Number(total) === 0) {
      throw new Error(
        "training.exercise_muscles está vacía: falta `yarn db:enrich:exercises`",
      );
    }
  } catch (error) {
    unavailable = true;
    const detail = error instanceof Error ? error.message : String(error);
    if (!skipRequested) {
      throw new Error(
        `No hay PostgreSQL migrado y enriquecido en ${databaseEnvironment.DB_HOST}:${databaseEnvironment.DB_PORT}/${databaseEnvironment.DB_NAME} (${detail}). ` +
          "Levanta la base, `yarn migration:up`, `yarn db:seed:all:development` y `yarn db:enrich:exercises`, " +
          "o sáltalas deliberadamente con SKIP_DB_INTEGRATION_TESTS=1.",
      );
    }
    console.warn("muscles integration specs skipped: SKIP_DB_INTEGRATION_TESTS=1");
  }
  const stub = {} as never;
  service = new MusclesService(
    sequelize,
    stub,
    MuscleModel,
    stub,
    stub,
    stub,
    stub,
  );
}, 30000);

afterAll(async () => {
  await sequelize?.close();
});

beforeEach(async () => {
  if (unavailable) return;
  await raw("BEGIN");
});

afterEach(async () => {
  if (unavailable) return;
  await raw("ROLLBACK");
});

describe("MusclesService.getMuscle (SQL real)", () => {
  it("returns the Spanish name, the Latin name and the group of a muscle", async () => {
    if (unavailable) return;
    const muscle = await service.getMuscle(CODE);
    expect(muscle.code).toBe(CODE);
    expect(muscle.nombre).toBe("Pectoral mayor");
    expect(muscle.nombreLatin).toBe("Pectoralis major");
    expect(muscle.grupo).toEqual({ code: "CHEST", nombre: "Pecho" });
  });

  it("accepts the code in lower case", async () => {
    if (unavailable) return;
    await expect(service.getMuscle("pectoralis_major")).resolves.toMatchObject({
      code: CODE,
    });
  });

  it("answers 404 for a code that is not in the taxonomy", async () => {
    if (unavailable) return;
    await expect(service.getMuscle("NO_SUCH_MUSCLE")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("MusclesService.listExercisesByMuscle (SQL real)", () => {
  it("reports the size of the whole set, not the size of the page", async () => {
    if (unavailable) return;
    const page = await service.listExercisesByMuscle(CODE, 5, 0);
    expect(page.ejercicios).toHaveLength(5);
    expect(page.total).toBeGreaterThan(5);
    expect(page.limit).toBe(5);
    expect(page.offset).toBe(0);
  });

  it("pages without repeating or skipping exercises", async () => {
    if (unavailable) return;
    const first = await service.listExercisesByMuscle(CODE, 6, 0);
    const second = await service.listExercisesByMuscle(CODE, 6, 6);
    const whole = await service.listExercisesByMuscle(CODE, 12, 0);
    expect(second.total).toBe(first.total);
    expect([...first.ejercicios, ...second.ejercicios].map((e) => e.id)).toEqual(
      whole.ejercicios.map((e) => e.id),
    );
  });

  it("lists primary exercises before secondary ones", async () => {
    if (unavailable) return;
    const { ejercicios, total } = await service.listExercisesByMuscle(CODE, 100, 0);
    const roles = ejercicios.map((e) => e.rol);
    const firstNonPrimary = roles.findIndex((r) => r !== "PRIMARY");
    if (firstNonPrimary !== -1) {
      expect(roles.slice(firstNonPrimary)).not.toContain("PRIMARY");
    }
    expect(total).toBeGreaterThanOrEqual(ejercicios.length);
  });

  it("returns an empty page that still reports the real total past the end", async () => {
    if (unavailable) return;
    const { total } = await service.listExercisesByMuscle(CODE, 5, 0);
    const past = await service.listExercisesByMuscle(CODE, 5, total + 10);
    expect(past.ejercicios).toEqual([]);
    expect(past.total).toBe(total);
    // Y no se confunde con «sin ejercicios»: no activa el músculo de reserva.
    expect(past.aproximado).toBeNull();
  });

  it("answers 404 for a code that is not in the taxonomy", async () => {
    if (unavailable) return;
    await expect(
      service.listExercisesByMuscle("NO_SUCH_MUSCLE", 5, 0),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("attaches the primary active image, and ignores inactive and video media", async () => {
    if (unavailable) return;
    const { ejercicios } = await service.listExercisesByMuscle(CODE, 1, 0);
    const exerciseId = ejercicios[0].id;
    await clearMedia(exerciseId);
    await insertMedia({
      id: "33333333-0000-4000-8000-000000000001",
      exerciseId,
      url: "https://example.test/secondary.jpg",
      isPrimary: false,
      sortOrder: 0,
    });
    await insertMedia({
      id: "33333333-0000-4000-8000-000000000002",
      exerciseId,
      url: "https://example.test/primary.jpg",
      isPrimary: true,
      sortOrder: 5,
    });
    await insertMedia({
      id: "33333333-0000-4000-8000-000000000003",
      exerciseId,
      url: "https://example.test/archived.jpg",
      isPrimary: false,
      sortOrder: -1,
      status: "ARCHIVED",
    });
    await insertMedia({
      id: "33333333-0000-4000-8000-000000000004",
      exerciseId,
      url: "https://example.test/clip.mp4",
      isPrimary: false,
      sortOrder: -2,
      mediaType: "VIDEO",
    });

    const after = await service.listExercisesByMuscle(CODE, 1, 0);
    expect(after.ejercicios[0].id).toBe(exerciseId);
    expect(after.ejercicios[0].imagen).toEqual({
      url: "https://example.test/primary.jpg",
      textoAlternativo: "lámina de prueba",
    });
  });

  it("falls back to the first active image by catalogue order when none is primary", async () => {
    if (unavailable) return;
    const { ejercicios } = await service.listExercisesByMuscle(CODE, 1, 0);
    const exerciseId = ejercicios[0].id;
    await clearMedia(exerciseId);
    await insertMedia({
      id: "33333333-0000-4000-8000-000000000011",
      exerciseId,
      url: "https://example.test/second.jpg",
      isPrimary: false,
      sortOrder: 3,
    });
    await insertMedia({
      id: "33333333-0000-4000-8000-000000000012",
      exerciseId,
      url: "https://example.test/first.jpg",
      isPrimary: false,
      sortOrder: 1,
    });
    const after = await service.listExercisesByMuscle(CODE, 1, 0);
    expect(after.ejercicios[0].imagen?.url).toBe("https://example.test/first.jpg");
  });

  it("leaves imagen null for an exercise with no usable media", async () => {
    if (unavailable) return;
    await raw(
      "DELETE FROM training.exercise_media WHERE ejercicio_id IN (SELECT ejercicio_id FROM training.exercise_muscles WHERE muscle_id = (SELECT id FROM training.muscles WHERE code = :code))",
      { code: CODE },
    );
    const { ejercicios } = await service.listExercisesByMuscle(CODE, 3, 0);
    expect(ejercicios.length).toBeGreaterThan(0);
    for (const exercise of ejercicios) expect(exercise.imagen).toBeNull();
  });
});

describe("MusclesService.listExercisesByMuscle — músculo de reserva (SQL real)", () => {
  it("answers with the related muscle's exercises, and says so, when the muscle has none of its own", async () => {
    if (unavailable) return;
    // El dataset etiqueta «delts», no el fascículo: ningún ejercicio es solo del deltoides anterior.
    const page = await service.listExercisesByMuscle("DELTOID_ANTERIOR", 5, 0);
    expect(page.musculo).toEqual({ code: "DELTOID_ANTERIOR", nombre: "Deltoides anterior" });
    expect(page.aproximado).toEqual({ code: "DELTOID", nombre: "Deltoides" });
    expect(page.total).toBeGreaterThan(0);
    expect(page.ejercicios.length).toBeGreaterThan(0);
    const parent = await service.listExercisesByMuscle("DELTOID", 5, 0);
    expect(page.total).toBe(parent.total);
    expect(page.ejercicios.map((e) => e.id)).toEqual(parent.ejercicios.map((e) => e.id));
  });

  it("pages the related muscle's exercises like any other", async () => {
    if (unavailable) return;
    const first = await service.listExercisesByMuscle("DELTOID_LATERAL", 4, 0);
    const second = await service.listExercisesByMuscle("DELTOID_LATERAL", 4, 4);
    expect(second.aproximado).toEqual(first.aproximado);
    const ids = [...first.ejercicios, ...second.ejercicios].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not use the fallback for a muscle that has exercises of its own", async () => {
    if (unavailable) return;
    const page = await service.listExercisesByMuscle("DELTOID", 5, 0);
    expect(page.aproximado).toBeNull();
    expect(page.total).toBeGreaterThan(0);
  });

  it("stops using the fallback as soon as the muscle gets an exercise of its own", async () => {
    if (unavailable) return;
    // Se le da un ejercicio propio al deltoides anterior (dentro de la transacción).
    const [{ id: exerciseId }] = await sequelize.query<{ id: string }>(
      "SELECT id FROM public.ejercicios WHERE estado = 'ACTIVO' ORDER BY id LIMIT 1",
      { type: QueryTypes.SELECT },
    );
    await raw(
      `INSERT INTO training.exercise_muscles (ejercicio_id, muscle_id, role)
       SELECT :exerciseId, id, 'PRIMARY' FROM training.muscles WHERE code = 'DELTOID_ANTERIOR'
       ON CONFLICT DO NOTHING`,
      { exerciseId },
    );
    const page = await service.listExercisesByMuscle("DELTOID_ANTERIOR", 5, 0);
    expect(page.aproximado).toBeNull();
    expect(page.total).toBe(1);
    expect(page.ejercicios[0].id).toBe(exerciseId);
  });
});
