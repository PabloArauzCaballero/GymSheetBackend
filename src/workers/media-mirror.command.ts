import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MediaMirrorService } from "../modules/media/media-mirror.service";
import { MediaMaintenanceModule } from "./media-maintenance.module";

/**
 * Mirroring de media externa a nuestro almacenamiento. Comando de una sola
 * ejecución (no worker): un operador o un job de despliegue decide cuándo corre.
 *
 * Seguro por defecto: sin `--apply` solo reporta cuántas filas de `media.files`
 * se servirían desde un origen externo (dry run). Con `--apply` las descarga
 * (SSRF-allowlist, forzando raster) y las guarda en el proveedor configurado,
 * poblando `storage_url`. Idempotente: no reprocesa filas ya migradas.
 *
 *   yarn db:media:mirror           # dry run
 *   yarn db:media:mirror --apply   # descarga y migra
 */
async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const application = await NestFactory.createApplicationContext(
    MediaMaintenanceModule,
    { logger: ["error", "warn", "log"] },
  );
  try {
    const service = application.get(MediaMirrorService);
    const files = await service.mirror({ apply });
    const exercises = await service.mirrorExerciseMedia({ apply });
    Logger.log(
      {
        event: apply ? "media.mirror.completed" : "media.mirror.dry_run",
        mediaFiles: files,
        exerciseMedia: exercises,
      },
      "MediaMirror",
    );
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  Logger.error(
    {
      event: "media.mirror.command_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    },
    error instanceof Error ? error.stack : undefined,
    "MediaMirror",
  );
  process.exitCode = 1;
});
