import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import {
  MediaStorageProvider,
  MediaUploadInput,
  MediaUploadTarget,
  mediaTargetPrefix,
  StoredAsset,
} from "../media-storage.port";
import { resolveMediaExtension } from "./mime-extension";

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
 * La clave replica el layout del adaptador remoto
 * (`users/<userId>/<categoria>/<sha256>.<ext>`, ver `mediaTargetPrefix`) para que
 * desarrollo y producción produzcan exactamente la misma estructura y cambiar de
 * proveedor no obligue a reescribir claves.
 *
 * Idempotencia por contenido: el nombre de archivo se deriva del SHA-256 del
 * binario, de modo que subir el mismo contenido dos veces EN LA MISMA CARPETA no
 * crea un archivo nuevo ni cambia la URL (`reused = true` en la segunda vez). La
 * deduplicación ya no cruza usuarios: dos socios que suben la misma foto tienen
 * cada uno la suya, porque la propiedad del contenido pesa más que el ahorro de
 * disco (y porque borrar la del primero no puede afectar al segundo).
 */
export class LocalStorageAdapter implements MediaStorageProvider {
  readonly name = "local" as const;
  readonly immutable = false;
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(config: LocalStorageConfig) {
    this.root = resolve(config.root);
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  }

  async upload(
    input: MediaUploadInput,
    target: MediaUploadTarget,
  ): Promise<StoredAsset> {
    const checksumSha256 = createHash("sha256").update(input.buffer).digest("hex");
    const extension = resolveMediaExtension(input.mimeType);
    const key = `${mediaTargetPrefix(target)}/${checksumSha256}${extension}`;
    const absolutePath = this.resolveWithinRoot(key);

    const reused = existsSync(absolutePath);
    if (!reused) {
      await mkdir(dirname(absolutePath), { recursive: true });
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
      key,
      url: `${this.publicBaseUrl}/${key}`,
      sizeBytes: input.buffer.byteLength,
      checksumSha256,
      reused,
    };
  }

  async remove(key: string): Promise<void> {
    const absolutePath = this.resolveWithinRoot(key);
    if (existsSync(absolutePath)) await unlink(absolutePath);
  }

  /**
   * Resuelve una clave dentro de la raíz y se niega a salir de ella.
   *
   * Mientras las claves eran un SHA-256 plano, `join(root, key)` no podía
   * escaparse. Ahora llevan barras y llegan desde la base de datos, así que un
   * valor con `..` —fila corrompida, migración mal hecha, dato importado—
   * apuntaría a un `unlink` fuera del almacén. El guardia es barato y convierte
   * ese caso en un error visible en vez de un borrado silencioso.
   */
  private resolveWithinRoot(key: string): string {
    const absolutePath = resolve(join(this.root, key));
    if (
      absolutePath !== this.root &&
      !absolutePath.startsWith(`${this.root}${sep}`)
    ) {
      throw new Error(
        `Clave de almacenamiento fuera de la raíz de media: ${key}`,
      );
    }
    return absolutePath;
  }
}
