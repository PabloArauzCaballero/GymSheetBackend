import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, unlink, writeFile } from "fs/promises";
import { extname, join, resolve } from "path";
import {
  MediaStorageProvider,
  MediaUploadInput,
  StoredAsset,
} from "../media-storage.port";

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
};

export interface LocalStorageConfig {
  /** Directorio raíz donde se escriben los binarios. */
  readonly root: string;
  /** Base URL pública bajo la que se sirve `root` (sin barra final). */
  readonly publicBaseUrl: string;
}

/**
 * Adaptador de almacenamiento en disco local. Es el respaldo del `FileInterceptor`
 * de Multer (memoryStorage): recibe el buffer en memoria y lo persiste en disco.
 *
 * Idempotencia por contenido: el nombre de archivo se deriva del SHA-256 del
 * binario, de modo que subir el mismo contenido dos veces no crea un archivo
 * nuevo ni cambia la URL (`reused = true` en la segunda vez).
 */
export class LocalStorageAdapter implements MediaStorageProvider {
  readonly name = "local" as const;
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(config: LocalStorageConfig) {
    this.root = resolve(config.root);
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  }

  async upload(input: MediaUploadInput): Promise<StoredAsset> {
    const checksumSha256 = createHash("sha256").update(input.buffer).digest("hex");
    const extension = this.resolveExtension(input);
    const fileName = `${checksumSha256}${extension}`;
    const absolutePath = join(this.root, fileName);

    const reused = existsSync(absolutePath);
    if (!reused) {
      await mkdir(this.root, { recursive: true });
      // `wx` falla si otro proceso ganó la carrera; en ese caso el contenido es
      // idéntico (misma clave por checksum), así que lo tratamos como reutilizado.
      try {
        await writeFile(absolutePath, input.buffer, { flag: "wx" });
      } catch (error) {
        if (!existsSync(absolutePath)) throw error;
      }
    }

    return {
      provider: this.name,
      key: fileName,
      url: `${this.publicBaseUrl}/${fileName}`,
      sizeBytes: input.buffer.byteLength,
      checksumSha256,
      reused,
    };
  }

  async remove(key: string): Promise<void> {
    const absolutePath = join(this.root, key);
    if (existsSync(absolutePath)) await unlink(absolutePath);
  }

  private resolveExtension(input: MediaUploadInput): string {
    const byMime = MIME_EXTENSION[input.mimeType.toLowerCase()];
    if (byMime) return byMime;
    const byName = extname(input.originalName).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(byName) ? byName : "";
  }
}
