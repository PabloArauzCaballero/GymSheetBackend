import { Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { Client } from "minio";
import {
  isDeletableContentKey,
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
  /**
   * The deployment declares that the API user may delete every version under
   * `users/*` (`MEDIA_USER_CONTENT_DELETABLE`, ADR-0017). When false, a
   * person's content is kept as under ADR-0010.
   */
  readonly userContentDeletable: boolean;
}

/** One stored version of an object, or a delete marker, as the SDK lists it. */
interface ObjectVersion {
  readonly name: string;
  readonly versionId: string;
}

/**
 * Adaptador de almacenamiento sobre MinIO (S3-compatible). Ver
 * [ADR-0010](../../../../docs/decisions/ADR-0010-minio-immutable-media.md) y
 * [ADR-0017](../../../../docs/decisions/ADR-0017-borrado-real-del-contenido-de-las-personas.md).
 *
 * ## What is deleted and what is not
 *
 * A person's content (`users/{userId}/…`) is really deletable: `remove` erases
 * EVERY version of the key, delete markers included, because the bucket is
 * versioned and a plain DELETE would only stack a delete marker on top of a
 * recoverable object. The administered catalog (`catalog/`, `ejercicios/`)
 * keeps the immutability of ADR-0010: `remove` refuses it with a logged
 * no-op, and the API user has no delete permission outside `users/*`.
 *
 * A removal the server rejects (AccessDenied while operations has not applied
 * the ADR-0017 policy, network failure) propagates: the `media.release` job
 * retries and dead-letters instead of completing over a file that survived.
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

  private readonly logger = new Logger(MinioStorageAdapter.name);
  private readonly client: Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly userContentDeletable: boolean;

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
    this.userContentDeletable = config.userContentDeletable;
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

  canRemove(key: string): boolean {
    return this.userContentDeletable && isDeletableContentKey(key);
  }

  /**
   * Erases every version of a person's object; refuses any other key.
   *
   * Listing uses `prefix = key` and then keeps only the exact name, so a
   * sibling such as `<key>.bak` is never touched. Versions are removed one by
   * one with their `versionId`; the first failure stops and propagates, and the
   * retry lists again, so a partial pass converges. Nothing listed means the
   * object is already gone: the call is idempotent.
   */
  async remove(key: string): Promise<void> {
    if (!this.canRemove(key)) {
      this.logger.log({
        event: "media.remove.immutable_key",
        provider: this.name,
        reason: isDeletableContentKey(key) ? "user_content_not_deletable" : "catalog_key",
        key,
      });
      return;
    }
    const versions = await this.listVersions(key);
    for (const version of versions) {
      await this.client.removeObject(this.bucket, key, { versionId: version.versionId });
    }
    this.logger.log({
      event: "media.remove.completed",
      provider: this.name,
      key,
      versionsRemoved: versions.length,
    });
  }

  async download(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(Array.from(chunk)));
      else throw new Error("MinIO devolvió un fragmento de archivo inválido.");
    }
    return Buffer.concat(chunks);
  }

  private async listVersions(key: string): Promise<ObjectVersion[]> {
    const stream = this.client.listObjects(this.bucket, key, true, { IncludeVersion: true });
    const versions: ObjectVersion[] = [];
    for await (const item of stream as AsyncIterable<unknown>) {
      const version = asObjectVersion(item);
      if (version?.name === key) versions.push(version);
    }
    return versions;
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

/**
 * The SDK types list items without `versionId`, although a versioned listing
 * carries it (and delete markers too). An unversioned bucket reports "null",
 * which S3 accepts as the id of the single, unversioned object.
 */
function asObjectVersion(item: unknown): ObjectVersion | null {
  if (typeof item !== "object" || item === null) return null;
  const { name, versionId } = item as { name?: unknown; versionId?: unknown };
  if (typeof name !== "string") return null;
  return { name, versionId: typeof versionId === "string" && versionId !== "" ? versionId : "null" };
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "NotFound" || code === "NoSuchKey";
}
