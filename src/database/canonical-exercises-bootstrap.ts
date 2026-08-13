import { Logger } from "@nestjs/common";
import { existsSync } from "fs";
import { resolve } from "path";
import { env } from "../config/env";

/**
 * Selector de fuente canónica del catálogo de ejercicios (ADR-0006, opción b).
 *
 * Diseño elegido por el propietario: el arranque NO depende de la red. En modo
 * `github` el import lo posee el worker dedicado (`worker:exercises-dataset`); en
 * modo `seeders` el arranque aplica un snapshot local si está presente. No hay
 * fallback silencioso entre fuentes (la validación de entorno lo impide).
 */
export type CanonicalExercisesSource = "seeders" | "github";

export interface CanonicalExercisesPlan {
  readonly source: CanonicalExercisesSource;
  readonly action: "seed-local-snapshot" | "defer-to-worker";
}

/** Ruta del snapshot local de ejercicios (relativa a la raíz del proyecto). */
export const EXERCISES_BOOT_SNAPSHOT_PATH =
  "src/database/seeders/boot/exercises.snapshot.json";

/**
 * Decide, de forma pura y testeable, qué debe hacer el arranque con el catálogo
 * de ejercicios. Lanza si la combinación es incoherente (defensa en profundidad;
 * la validación de entorno ya rechaza `github` sin dataset habilitado).
 */
export function planCanonicalExercisesBootstrap(
  source: CanonicalExercisesSource,
  datasetEnabled: boolean,
): CanonicalExercisesPlan {
  if (source === "github") {
    if (!datasetEnabled)
      throw new Error(
        "CANONICAL_EXERCISES_SOURCE=github requires EXERCISES_DATASET_ENABLED=true.",
      );
    return { source, action: "defer-to-worker" };
  }
  return { source, action: "seed-local-snapshot" };
}

const logger = new Logger("CanonicalExercisesBootstrap");

/**
 * Anuncia, de forma observable, la fuente canónica de ejercicios resuelta para
 * este arranque. NO puebla el catálogo por sí mismo: en ambos modos la carga la
 * realiza hoy el worker/CLI del dataset (`worker:exercises-dataset`). En modo
 * `seeders` además reporta si existe un snapshot local versionado; la aplicación
 * de ese snapshot es el único paso mecánico pendiente (ver ADR-0006). No se
 * fabrican datos: sin snapshot, el worker sigue siendo el poblador.
 */
export function bootstrapCanonicalExercises(): void {
  const plan = planCanonicalExercisesBootstrap(
    env.CANONICAL_EXERCISES_SOURCE,
    env.EXERCISES_DATASET_ENABLED,
  );
  const snapshotPresent =
    plan.action === "seed-local-snapshot" &&
    existsSync(resolve(EXERCISES_BOOT_SNAPSHOT_PATH));
  logger.log({
    event: "bootstrap.exercises.source",
    source: plan.source,
    action: plan.action,
    snapshotPresent,
    populatedBy: "worker:exercises-dataset",
  });
}
