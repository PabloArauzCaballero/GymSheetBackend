import { Injectable, Logger } from "@nestjs/common";
import { MediaReferenceReleaseService } from "../media/media-reference-release.service";
import { StoriesRepository } from "./stories.repository";

/** Resultado de una pasada de purga; se emite tal cual en el log del worker. */
export interface StoriesPurgeResult {
  /** Stories caducadas encontradas en esta pasada (tope: el tamaño de lote). */
  readonly examined: number;
  /** Filas efectivamente borradas. */
  readonly deleted: number;
  /** Files queued on `media.release` (the others are still referenced). */
  readonly releasesQueued: number;
  /** Stories que fallaron; se reintentarán en la siguiente pasada. */
  readonly failed: number;
}

/**
 * Purga de stories caducadas.
 *
 * Una story expira a las 24h y el feed la filtra por `expires_at`, pero la fila
 * y su binario seguían en el sistema para siempre: la tabla y `storage/media`
 * crecían sin techo. Esto las borra.
 *
 * El binario NO se borra sin más: pasa por `MediaReferenceReleaseService`, la
 * misma ruta que usa el borrado manual de una story o de una foto de perfil, de
 * modo que una story caducada que comparte contenido con la foto de perfil de
 * otra cuenta deja el fichero intacto. The removal itself is a `media.release`
 * outbox job written with the row deletion (ADR-0017 §4): a storage failure is
 * retried with backoff and dead-letters visibly instead of being dropped.
 *
 * Idempotente: cada story se procesa en su propia transacción y el borrado es
 * por id; repetir la pasada sobre lo ya purgado no encuentra nada. Un fallo
 * aislado no aborta el lote — se cuenta y se reintenta en la pasada siguiente.
 */
@Injectable()
export class StoriesPurgeService {
  private readonly logger = new Logger(StoriesPurgeService.name);

  constructor(
    private readonly repository: StoriesRepository,
    private readonly mediaRelease: MediaReferenceReleaseService,
  ) {}

  async purgeExpired(
    batchSize: number,
    now: Date = new Date(),
  ): Promise<StoriesPurgeResult> {
    const expired = await this.repository.findExpired(now, batchSize);
    let deleted = 0;
    let releasesQueued = 0;
    let failed = 0;

    for (const story of expired) {
      try {
        releasesQueued += await this.mediaRelease.clearAndRelease(
          { aggregateType: "story", aggregateId: story.id, provider: story.storageProvider, storageKeys: [story.storageKey] },
          async (transaction) => {
            await this.repository.deleteById(story.id, transaction);
          },
        );
        deleted += 1;
      } catch (error: unknown) {
        failed += 1;
        this.logger.error({
          event: "stories_purge.story_failed",
          storyId: story.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { examined: expired.length, deleted, releasesQueued, failed };
  }
}
