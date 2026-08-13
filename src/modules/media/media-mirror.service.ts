import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { ExerciseMediaModel } from "../exercises/exercise-media.model";
import { MediaFileModel } from "../membership/media-file.model";
import { assertAllowedImageUrl, fetchImage } from "./image-fetch";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "./media-storage.port";

/** Token e interfaz de configuración del mirroring de media. */
export const MEDIA_MIRROR_CONFIG = Symbol("MEDIA_MIRROR_CONFIG");
export interface MediaMirrorConfig {
  readonly allowedHosts: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
  /** Base URL pública de nuestro storage; una URL que ya la use está migrada. */
  readonly publicBaseUrl: string;
}

export interface MediaMirrorResult {
  readonly candidates: number;
  readonly mirrored: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Copia a nuestro almacenamiento las imágenes de `media.files` que hoy se sirven
 * desde un origen externo (`storage_url IS NULL`, `source_url` remoto). Deja de
 * depender del origen externo en tiempo de servicio y **corrige el problema de
 * formato**: la descarga fuerza un raster (jpeg/png/webp), evitando la
 * negociación a AVIF que rompe imágenes en algunos clientes.
 *
 * Idempotente: solo procesa filas sin `storage_url`; el adaptador deduplica por
 * checksum. Preserva la procedencia (`source_url`, `source_name`, licencia y
 * atribución) — solo popula `storage_url`, que el mapper ya prefiere.
 */
@Injectable()
export class MediaMirrorService {
  private readonly logger = new Logger(MediaMirrorService.name);

  constructor(
    @InjectModel(MediaFileModel)
    private readonly mediaFileModel: typeof MediaFileModel,
    @InjectModel(ExerciseMediaModel)
    private readonly exerciseMediaModel: typeof ExerciseMediaModel,
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
    @Inject(MEDIA_MIRROR_CONFIG)
    private readonly config: MediaMirrorConfig,
  ) {}

  async mirror({ apply }: { apply: boolean }): Promise<MediaMirrorResult> {
    const rows = await this.mediaFileModel.findAll({
      where: { storageUrl: null },
    });
    let mirrored = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        assertAllowedImageUrl(row.sourceUrl, this.config.allowedHosts);
      } catch {
        skipped += 1;
        this.logger.warn({
          event: "media.mirror.skipped",
          code: row.code,
          reason: "host_not_allowed_or_invalid_url",
        });
        continue;
      }
      if (!apply) continue;
      try {
        const image = await fetchImage(row.sourceUrl, {
          allowedHosts: this.config.allowedHosts,
          maxBytes: this.config.maxBytes,
          timeoutMs: this.config.timeoutMs,
        });
        const stored = await this.storage.upload({
          originalName: `${row.code}`,
          mimeType: image.mimeType,
          sizeBytes: image.buffer.byteLength,
          buffer: image.buffer,
        });
        await row.update({ storageUrl: stored.url });
        mirrored += 1;
        this.logger.log({
          event: "media.mirror.item",
          code: row.code,
          provider: stored.provider,
          reused: stored.reused,
          bytes: stored.sizeBytes,
        });
      } catch (error) {
        failed += 1;
        this.logger.error({
          event: "media.mirror.failed",
          code: row.code,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { candidates: rows.length, mirrored, skipped, failed };
  }

  /**
   * Descarga a nuestro almacenamiento las imágenes de `training.exercise_media`
   * que hoy se sirven desde un host externo, repuntando `url` a nuestra URL local
   * y guardando `checksum_sha256` y `mime_type`. Preserva el origen en `metadata`.
   *
   * Idempotente: omite filas cuya `url` ya apunta a nuestro `publicBaseUrl`.
   * Requiere que el importador del dataset esté desactivado (o dejará de servir
   * localmente en el siguiente refresco): ver EXERCISES_DATASET_ENABLED.
   */
  async mirrorExerciseMedia({
    apply,
  }: {
    apply: boolean;
  }): Promise<MediaMirrorResult> {
    const rows = await this.exerciseMediaModel.findAll();
    let candidates = 0;
    let mirrored = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      if (row.url.startsWith(this.config.publicBaseUrl)) continue;
      try {
        assertAllowedImageUrl(row.url, this.config.allowedHosts);
      } catch {
        skipped += 1;
        continue;
      }
      candidates += 1;
      if (!apply) continue;
      try {
        const originalUrl = row.url;
        const image = await fetchImage(originalUrl, {
          allowedHosts: this.config.allowedHosts,
          maxBytes: this.config.maxBytes,
          timeoutMs: this.config.timeoutMs,
        });
        const stored = await this.storage.upload({
          originalName: `exercise-${row.exerciseId}-${row.mediaType}`,
          mimeType: image.mimeType,
          sizeBytes: image.buffer.byteLength,
          buffer: image.buffer,
        });
        await row.update({
          url: stored.url,
          mimeType: image.mimeType,
          checksumSha256: stored.checksumSha256,
          metadata: {
            ...row.metadata,
            mirroredLocally: true,
            mirroredFrom: originalUrl,
          },
        });
        mirrored += 1;
      } catch (error) {
        failed += 1;
        this.logger.error({
          event: "media.mirror.exercise_failed",
          exerciseId: row.exerciseId,
          mediaType: row.mediaType,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { candidates, mirrored, skipped, failed };
  }
}
