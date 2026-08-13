import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExerciseEnrichmentService } from "../modules/exercises/muscles/exercise-enrichment.service";
import { ExerciseEnrichmentModule } from "./exercise-enrichment.module";

/**
 * Enriquecimiento del catálogo: siembra el catálogo de músculos y grupos,
 * reconstruye las relaciones ejercicio↔músculo (con rol) a partir de los campos
 * reales del catálogo y calcula la puntuación editorial de cada ejercicio.
 *
 * Determinista e idempotente (reconstrucción completa). Ejecución única:
 *
 *   yarn db:enrich:exercises
 */
async function run(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    ExerciseEnrichmentModule,
    { logger: ["error", "warn", "log"] },
  );
  try {
    const result = await application.get(ExerciseEnrichmentService).enrich();
    Logger.log(
      { event: "exercise.enrichment.command_completed", ...result },
      "ExerciseEnrichment",
    );
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  Logger.error(
    {
      event: "exercise.enrichment.command_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    },
    error instanceof Error ? error.stack : undefined,
    "ExerciseEnrichment",
  );
  process.exitCode = 1;
});
