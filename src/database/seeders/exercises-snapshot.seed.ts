import { Logger } from "@nestjs/common";
import { gunzipSync } from "zlib";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { env } from "../../config/env";
import {
  EXERCISES_BOOT_SNAPSHOT_GZIP_PATH,
  EXERCISES_BOOT_SNAPSHOT_PATH,
} from "../canonical-exercises-bootstrap";

const logger = new Logger("ExercisesSnapshotSeeder");

/**
 * El catálogo de ejercicios como semilla de arranque (ADR-0006, opción b).
 *
 * Hasta ahora el arranque solo ANUNCIABA la fuente y el catálogo lo poblaba un
 * worker que descarga un JSON de GitHub. Eso deja cualquier instalación nueva
 * —un entorno de test recién creado, el portátil de alguien que acaba de clonar—
 * con la pantalla de ejercicios vacía hasta que alguien se acuerda de lanzar el
 * worker, y ata el arranque a que la red y ese repositorio sigan ahí.
 *
 * Este sembrador aplica el snapshot versionado en el repo: 1.324 ejercicios con
 * su descripción en español, sus instrucciones por idioma y el resto de datos
 * detallados. Sin red, determinista y en la misma transacción que el resto de
 * catálogos.
 *
 * **Solo inserta lo que falta.** Un ejercicio ya presente no se toca: el
 * snapshot es el punto de partida de una instalación, no una autoridad que deba
 * pisar lo que el gimnasio haya corregido después. Reimportar y actualizar sigue
 * siendo trabajo del worker del dataset, que para eso tiene versión y checksum.
 */

/** Una fila del snapshot: los campos canónicos de un ejercicio, sin id ni fechas. */
const snapshotExerciseSchema = z.object({
  nombre: z.string().min(1),
  grupo_muscular: z.string().min(1),
  descripcion: z.string().nullable(),
  tipo_ejercicio: z.string().min(1),
  estado: z.string().min(1),
  data_source: z.string().min(1),
  external_id: z.string().min(1),
  external_version: z.string().nullable(),
  source_url: z.string().nullable(),
  source_license: z.string().nullable(),
  source_attribution: z.string().nullable(),
  category: z.string().nullable(),
  body_part: z.string().nullable(),
  required_equipment: z.string().nullable(),
  target_muscle: z.string().nullable(),
  synergist_muscle_group: z.string().nullable(),
  secondary_muscles: z.unknown(),
  instructions: z.unknown(),
  instruction_steps: z.unknown(),
  metadata: z.unknown(),
});

export const exercisesSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  count: z.number().int().nonnegative(),
  exercises: z.array(snapshotExerciseSchema),
});

export type ExercisesSnapshot = z.infer<typeof exercisesSnapshotSchema>;
export type SnapshotExercise = z.infer<typeof snapshotExerciseSchema>;

/**
 * Cuántas filas van en cada INSERT. El snapshot entero en una sola sentencia
 * son ~17 MB de JSON por el cable y un plan de consulta enorme; en trozos de
 * 200 la memoria del servidor no se resiente y el progreso es observable.
 */
export const SNAPSHOT_CHUNK_SIZE = 200;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("El tamaño de lote debe ser mayor que cero.");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Ruta del snapshot presente en disco, comprimido si existe; nulo si no hay ninguno. */
export function resolveSnapshotFile(
  exists: (path: string) => boolean = existsSync,
): string | null {
  const gzip = resolve(EXERCISES_BOOT_SNAPSHOT_GZIP_PATH);
  if (exists(gzip)) return gzip;
  const plain = resolve(EXERCISES_BOOT_SNAPSHOT_PATH);
  return exists(plain) ? plain : null;
}

/** Lee y valida el snapshot. Acepta `.json` y `.json.gz`. */
export function readSnapshot(file: string): ExercisesSnapshot {
  const raw = readFileSync(file);
  const text = file.endsWith(".gz")
    ? gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
  return exercisesSnapshotSchema.parse(JSON.parse(text) as unknown);
}

/**
 * Columnas del INSERT. El orden importa: es el mismo que la lista de
 * `jsonb_to_recordset`, y una discrepancia aquí sería un desplazamiento
 * silencioso de datos entre columnas.
 */
const INSERT_SQL = `
INSERT INTO ejercicios (
  id, nombre, grupo_muscular, descripcion, tipo_ejercicio, created_by_usuario_id,
  estado, data_source, external_id, external_version, source_url, source_license,
  source_attribution, category, body_part, required_equipment, target_muscle,
  synergist_muscle_group, secondary_muscles, instructions, instruction_steps,
  metadata, imported_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), s.nombre, s.grupo_muscular, s.descripcion, s.tipo_ejercicio, NULL,
  s.estado, s.data_source, s.external_id, s.external_version, s.source_url, s.source_license,
  s.source_attribution, s.category, s.body_part, s.required_equipment, s.target_muscle,
  s.synergist_muscle_group,
  COALESCE(s.secondary_muscles, '[]'::jsonb),
  COALESCE(s.instructions, '{}'::jsonb),
  COALESCE(s.instruction_steps, '{}'::jsonb),
  COALESCE(s.metadata, '{}'::jsonb),
  NOW(), NOW(), NOW()
FROM jsonb_to_recordset(CAST(:payload AS jsonb)) AS s(
  nombre text, grupo_muscular text, descripcion text, tipo_ejercicio text,
  estado text, data_source text, external_id text, external_version text,
  source_url text, source_license text, source_attribution text, category text,
  body_part text, required_equipment text, target_muscle text,
  synergist_muscle_group text, secondary_muscles jsonb, instructions jsonb,
  instruction_steps jsonb, metadata jsonb
)
ON CONFLICT (data_source, external_id) WHERE external_id IS NOT NULL DO NOTHING
RETURNING 1
`;

export interface SnapshotSeedResult {
  applied: boolean;
  reason?: "source-is-github" | "no-snapshot-file";
  file?: string;
  total: number;
  inserted: number;
  skipped: number;
}

/**
 * Aplica el snapshot dentro de la transacción de siembra.
 *
 * Va **antes** de `seedExerciseEquipment` porque ese paso enlaza ejercicios con
 * máquinas y solo ve lo que ya existe: aplicarlo después dejaría los enlaces a
 * cero hasta el siguiente arranque, que es exactamente la trampa que costó una
 * verificación en el despliegue de test.
 */
export async function seedExercisesFromSnapshot(
  sequelize: Sequelize,
  transaction: Transaction,
): Promise<SnapshotSeedResult> {
  if (env.CANONICAL_EXERCISES_SOURCE !== "seeders") {
    return {
      applied: false,
      reason: "source-is-github",
      total: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  const file = resolveSnapshotFile();
  if (!file) {
    // Sin snapshot no se inventa nada: el worker del dataset sigue siendo el
    // poblador, igual que antes de existir este sembrador.
    logger.warn({
      event: "database.seed.exercises_snapshot.missing",
      expected: EXERCISES_BOOT_SNAPSHOT_GZIP_PATH,
    });
    return {
      applied: false,
      reason: "no-snapshot-file",
      total: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  const snapshot = readSnapshot(file);
  let inserted = 0;
  for (const batch of chunk(snapshot.exercises, SNAPSHOT_CHUNK_SIZE)) {
    const rows = await sequelize.query<{ "?column?": number }>(INSERT_SQL, {
      replacements: { payload: JSON.stringify(batch) },
      type: QueryTypes.SELECT,
      transaction,
    });
    inserted += rows.length;
  }

  const result: SnapshotSeedResult = {
    applied: true,
    file,
    total: snapshot.exercises.length,
    inserted,
    skipped: snapshot.exercises.length - inserted,
  };
  logger.log({
    event: "database.seed.exercises_snapshot.applied",
    generatedAt: snapshot.generatedAt,
    ...result,
  });
  return result;
}
