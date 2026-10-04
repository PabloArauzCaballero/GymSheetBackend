import { config as loadEnvironmentFile } from "dotenv";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { databaseModels } from "../../../database/models";
import { ExerciseEnrichmentService } from "./exercise-enrichment.service";
import { ExerciseMuscleModel } from "./exercise-muscle.model";
import { ExerciseRatingModel } from "./exercise-rating.model";
import { MuscleGroupModel } from "./muscle-group.model";
import { MuscleModel } from "./muscle.model";

/**
 * `db:enrich:exercises` contra PostgreSQL real: tiene que poder ejecutarse más
 * de una vez. La carga de la biblioteca lo vuelve a lanzar después de cada
 * entrega, y antes reventaba en la segunda pasada: el `bulkCreate` de grupos y
 * músculos generaba `ON CONFLICT (id)`, los ids nuevos nunca chocaban y el
 * INSERT tropezaba con la unicidad de `code`.
 *
 * El enriquecimiento es una reconstrucción determinista (borra y rehace las
 * relaciones a partir del catálogo), así que ejecutarlo aquí deja la base igual
 * que estaba. Necesita la base migrada; para saltarla a propósito,
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

let sequelize: Sequelize;
let service: ExerciseEnrichmentService;
let unavailable = false;

beforeAll(async () => {
  sequelize = new Sequelize({
    dialect: "postgres",
    host: databaseEnvironment.DB_HOST,
    port: databaseEnvironment.DB_PORT,
    database: databaseEnvironment.DB_NAME,
    username: databaseEnvironment.DB_USER,
    password: databaseEnvironment.DB_PASSWORD,
    logging: false,
    pool: { max: 2, min: 0, acquire: 10000, idle: 1000 },
    // El grafo entero: los modelos de músculos referencian ejercicios, y
    // estos a usuarios, sedes, etc.
    models: databaseModels,
  });
  try {
    await sequelize.authenticate();
  } catch (error) {
    unavailable = true;
    const detail = error instanceof Error ? error.message : String(error);
    if (!skipRequested) {
      throw new Error(
        `No hay PostgreSQL migrado en ${databaseEnvironment.DB_HOST}:${databaseEnvironment.DB_PORT}/${databaseEnvironment.DB_NAME} (${detail}). ` +
          "Levanta la base y `yarn migration:up`, o sáltalas con SKIP_DB_INTEGRATION_TESTS=1.",
      );
    }
  }
  service = new ExerciseEnrichmentService(
    sequelize,
    MuscleGroupModel,
    MuscleModel,
    ExerciseMuscleModel,
    ExerciseRatingModel,
  );
});

afterAll(async () => {
  await sequelize?.close();
});

async function count(table: string): Promise<number> {
  const [{ total }] = await sequelize.query<{ total: string }>(
    `SELECT count(*) AS total FROM ${table}`,
    { type: QueryTypes.SELECT },
  );
  return Number(total);
}

describe("ExerciseEnrichmentService.enrich (SQL real)", () => {
  it("se puede ejecutar dos veces seguidas y la segunda no cambia nada", async () => {
    if (unavailable) return;

    const first = await service.enrich();
    const groups = await count("training.muscle_groups");
    const muscles = await count("training.muscles");
    const relations = await count("training.exercise_muscles");

    const second = await service.enrich();

    expect(second).toEqual(first);
    expect(await count("training.muscle_groups")).toBe(groups);
    expect(await count("training.muscles")).toBe(muscles);
    expect(await count("training.exercise_muscles")).toBe(relations);
  }, 60000);
});
