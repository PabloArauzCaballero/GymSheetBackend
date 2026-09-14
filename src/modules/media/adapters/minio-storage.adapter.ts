import { Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { Client } from "minio";
import {
  MediaStorageProvider,
  MediaUploadInput,
  MediaUploadTarget,
  mediaTargetPrefix,
  StoredAsset,
} from "../media-storage.port";
import { resolveMediaExtension } from "./mime-extension";

export interface MinioStorageConfig {
  /** Host del servidor MinIO (sin esquema ni puerto). */
  readonly endPoint: string;
  readonly port: number;
  readonly useSSL: boolean;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly region: string;
  /** Base URL pública bajo la que se sirve el bucket (sin barra final). */
  readonly publicBaseUrl: string;
}

/**
 * Adaptador de almacenamiento sobre MinIO (S3-compatible). Ver
 * [ADR-0010](../../../../docs/decisions/ADR-0010-minio-immutable-media.md).
 *
 * ## Los objetos no se borran nunca
 *
 * Es un requisito de producto, no una propiedad del adaptador: lo que sube un
 * socio se conserva aunque el producto deje de mostrarlo. Por eso `remove()` es
 * un no-op y `immutable` lo declara al puerto, para que
 * `MediaRetentionService` no anuncie un borrado que no ocurrió.
 *
 * El no-op es la capa más débil de las tres que sostienen la garantía, y la
 * única que un cambio de código puede tumbar sin querer: las otras dos viven en
 * el servidor (las credenciales de la API no tienen `s3:DeleteObject`, y el
 * bucket está versionado). Si alguien quita este no-op, MinIO sigue diciendo
 * que no.
 *
 * ## Idempotencia
 *
 * La clave es `<prefijo del destino>/<sha256>.<ext>`, así que subir dos veces el
 * mismo binario a la misma carpeta produce la misma clave. Se comprueba con
 * `statObject` antes de escribir para poder informar `reused` con honestidad;
 * la escritura en sí ya sería idempotente sin la comprobación.
 */
export class MinioStorageAdapter implements MediaStorageProvider {
  readonly name = "minio" as const;
  readonly immutable = true;

  private readonly logger = new Logger(MinioStorageAdapter.name);
  private readonly client: Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: MinioStorageConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
    });
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  }

  async upload(
    input: MediaUploadInput,
    target: MediaUploadTarget,
  ): Promise<StoredAsset> {
    const checksumSha256 = createHash("sha256")
      .update(input.buffer)
      .digest("hex");
    const extension = resolveMediaExtension(input.mimeType);
    const key = `${mediaTargetPrefix(target)}/${checksumSha256}${extension}`;

    const reused = await this.objectExists(key);
    if (!reused) {
      await this.client.putObject(
        this.bucket,
        key,
        input.buffer,
        input.buffer.byteLength,
        {
          // Del tipo YA validado, nunca del nombre que manda el cliente: quien
          // elige el Content-Type elige cómo interpreta el navegador el fichero
          // (ver la nota de XSS almacenado en `mime-extension.ts`).
          "Content-Type": input.mimeType.toLowerCase(),
          // Misma contención que el montaje estático de `main.ts` para los
          // mismos bytes ajenos. No afecta a `<img src>`: los navegadores solo
          // honran `attachment` en navegaciones, no en subrecursos.
          "Content-Disposition": "attachment",
          "x-amz-meta-sha256": checksumSha256,
        },
      );
    }

    return {
      provider: this.name,
      key,
      url: `${this.publicBaseUrl}/${key}`,
      sizeBytes: input.buffer.byteLength,
      checksumSha256,
      reused,
    };
  }

  /**
   * No borra: el almacén es inmutable por decisión de producto (ADR-0010).
   * Se deja trazado para poder auditar qué se habría borrado.
   */
  async remove(key: string): Promise<void> {
    this.logger.log({
      event: "media.storage.remove_skipped",
      reason: "immutable_storage",
      provider: this.name,
      key,
    });
    return Promise.resolve();
  }

  /**
   * `statObject` es la forma barata de preguntar por existencia; el SDK señala
   * el "no está" con un error tipado, así que hay que distinguirlo de un fallo
   * real de red o de permisos —que sí debe propagarse, no hacerse pasar por
   * "no existe" y provocar una reescritura silenciosa.
   */
  private async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "NotFound" || code === "NoSuchKey";
}
