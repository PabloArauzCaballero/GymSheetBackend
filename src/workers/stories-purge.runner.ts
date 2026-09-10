import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { StoriesPurgeService } from "../modules/stories/stories-purge.service";
import { sleep } from "./worker-loop";

/**
 * Worker de purga de stories caducadas.
 *
 * Mismo contrato que el resto de runners: un bucle que respeta el `AbortSignal`
 * del bootstrap, un fallo aislado no mata el proceso, y logs estructurados con
 * `event:` para poder alertar sobre ellos.
 */
@Injectable()
export class StoriesPurgeRunner {
  private readonly logger = new Logger(StoriesPurgeRunner.name);

  constructor(private readonly purge: StoriesPurgeService) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: "worker.started", worker: "stories-purge" });

    while (!signal.aborted) {
      try {
        const result = await this.purge.purgeExpired(
          env.STORIES_PURGE_BATCH_SIZE,
        );

        if (result.examined > 0) {
          this.logger.log({
            event: "stories_purge.batch_completed",
            examined: result.examined,
            deleted: result.deleted,
            filesRemoved: result.filesRemoved,
            failed: result.failed,
          });
        }

        // Lote lleno y con progreso: hay atraso acumulado, se sigue drenando
        // sin esperar. El `deleted > 0` evita el bucle cerrado si todo falla.
        if (
          result.examined >= env.STORIES_PURGE_BATCH_SIZE &&
          result.deleted > 0
        ) {
          continue;
        }
      } catch (error: unknown) {
        this.logger.error({
          event: "stories_purge.scan_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }

      await sleep(env.STORIES_PURGE_INTERVAL_MS, signal);
    }

    this.logger.log({ event: "worker.stopped", worker: "stories-purge" });
  }
}
