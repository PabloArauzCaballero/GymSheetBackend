import { Logger } from "@nestjs/common";
import { gzipSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../config/env";
import { EXERCISES_BOOT_SNAPSHOT_GZIP_PATH } from "../database/canonical-exercises-bootstrap";
import type { SnapshotExercise } from "../database/seeders/exercises-snapshot.seed";

/**
 * Genera el snapshot de arranque del catálogo de ejercicios desde la base
 * actual: el archivo que `seedExercisesFromSnapshot` aplica al arrancar.
 *
 * Se ejecuta a mano, no en cada despliegue, y su resultado se versiona en el
 * repo. La descarga del dataset externo sigue siendo trabajo del worker; esto
 * solo fotografía lo que ya está validado en una base real para que cualquier
 * instalación nueva parta de ahí sin tocar la red.
 *
 *   yarn db:snapshot:exercises
 *
 * Determinista: ordena por identificador externo y no guarda ni `id` ni fechas,
 * que se generan al insertar. Así dos ejecuciones sobre el mismo catálogo dan
 * exactamente el mismo archivo y el repo no acumula diferencias de ruido.
 */

const logger = new Logger("ExercisesSnapshot");

const SELECT_SQL = `
SELECT nombre, grupo_muscular, descripcion, tipo_ejercicio, estado, data_source,
       external_id, external_version, source_url, source_license, source_attribution,
       category, body_part, required_equipment, target_muscle, synergist_muscle_group,
       secondary_muscles, instructions, instruction_steps, metadata
  FROM ejercicios
 WHERE data_source <> 'CUSTOM'
   AND external_id IS NOT NULL
 ORDER BY data_source, external_id
`;

async function run(): Promise<void> {
  const sequelize = new Sequelize({
    dialect: "postgres",
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    logging: false,
    dialectOptions: {
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
    await sequelize.authenticate();
    const exercises = await sequelize.query<SnapshotExercise>(SELECT_SQL, {
      type: QueryTypes.SELECT,
    });

    const snapshot = {
      version: 1 as const,
      // Fecha en día, no en instante: el minuto exacto no aporta nada y haría
      // que cada regeneración ensuciara el repo aunque el catálogo no cambie.
      generatedAt: new Date().toISOString().slice(0, 10),
      source: `${env.DB_NAME} (${exercises.length} ejercicios)`,
      count: exercises.length,
      exercises,
    };

    const target = resolve(EXERCISES_BOOT_SNAPSHOT_GZIP_PATH);
    mkdirSync(dirname(target), { recursive: true });
    // Nivel 9 y sin fecha en la cabecera —Node no la escribe—, así que el gzip
    // es reproducible byte a byte: regenerar sin cambios no ensucia el repo.
    const compressed = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"), {
      level: 9,
    });
    writeFileSync(target, compressed);

    logger.log({
      event: "exercises.snapshot.written",
      file: EXERCISES_BOOT_SNAPSHOT_GZIP_PATH,
      count: exercises.length,
      bytes: compressed.byteLength,
    });
  } finally {
    await sequelize.close();
  }
}

void run().catch((error: unknown) => {
  logger.error({
    event: "exercises.snapshot.failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
