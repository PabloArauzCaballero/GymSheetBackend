import { UnsupportedMediaTypeException } from "@nestjs/common";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join, resolve } from "path";
import {
  MediaStorageProvider,
  MediaUploadInput,
  StoredAsset,
} from "../media-storage.port";

/**
 * Única fuente de la extensión con la que se escribe un binario en disco.
 *
 * La extensión NO puede derivarse del nombre que manda el cliente: `express.static`
 * resuelve el `Content-Type` a partir de ella, así que quien elige la extensión
 * elige cómo se interpreta el fichero al servirlo. Un adjunto declarado
 * `video/quicktime` con nombre `algo.html` quedaba escrito como `<sha>.html` y se
 * servía como `text/html` desde el propio origen de la API — XSS almacenado.
 *
 * Por eso el mapa es cerrado y `resolveExtension` rechaza lo que no esté aquí:
 * añadir un tipo permitido en `MEDIA_ALLOWED_MIME` o `CHAT_MEDIA_ALLOWED_MIME`
 * obliga a declarar también su extensión, y olvidarlo falla de forma visible en
 * vez de abrir el agujero en silencio.
 */
export const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
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

  /**
   * Deriva la extensión SÓLO del tipo declarado y validado, nunca del nombre
   * que envía el cliente. Antes había un respaldo a `extname(originalName)`
   * para los MIME sin mapear: bastaba declarar un tipo permitido pero no
   * mapeado y llamar al fichero `algo.html` para escribir `<sha>.html` en la
   * raíz pública. Un MIME sin extensión conocida es un fallo de configuración
   * (alguien lo añadió a la allowlist sin añadirlo aquí), no algo que el
   * usuario deba poder resolver eligiendo el nombre.
   */
  private resolveExtension(input: MediaUploadInput): string {
    const extension = MIME_EXTENSION[input.mimeType.toLowerCase()];

    if (!extension) {
      throw new UnsupportedMediaTypeException(
        "Tipo de archivo no admitido para almacenamiento.",
      );
    }

    return extension;
  }
}
