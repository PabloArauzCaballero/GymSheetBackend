import { UnsupportedMediaTypeException } from "@nestjs/common";

/**
 * Única fuente de la extensión con la que se nombra un binario almacenado,
 * compartida por TODOS los adaptadores.
 *
 * La extensión NO puede derivarse del nombre que manda el cliente: quien elige
 * la extensión elige cómo se interpreta el fichero al servirlo. Con el adaptador
 * local, `express.static` resuelve el `Content-Type` a partir de ella, así que
 * un adjunto declarado `video/quicktime` con nombre `algo.html` quedaba escrito
 * como `<sha>.html` y se servía como `text/html` desde el propio origen de la
 * API — XSS almacenado.
 *
 * Por eso el mapa es cerrado y `resolveMediaExtension` rechaza lo que no esté
 * aquí: añadir un tipo permitido en `MEDIA_ALLOWED_MIME` o
 * `CHAT_MEDIA_ALLOWED_MIME` obliga a declarar también su extensión, y olvidarlo
 * falla de forma visible en vez de abrir el agujero en silencio.
 */
export const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
};

/**
 * Deriva la extensión SÓLO del tipo declarado y validado, nunca del nombre que
 * envía el cliente. Antes había un respaldo a `extname(originalName)` para los
 * MIME sin mapear: bastaba declarar un tipo permitido pero no mapeado y llamar
 * al fichero `algo.html` para escribir `<sha>.html` en la raíz pública.
 *
 * Un MIME sin extensión conocida es un fallo de configuración (alguien lo añadió
 * a la allowlist sin añadirlo aquí), no algo que el usuario deba poder resolver
 * eligiendo el nombre.
 */
export function resolveMediaExtension(mimeType: string): string {
  const extension = MIME_EXTENSION[mimeType.toLowerCase()];

  if (!extension) {
    throw new UnsupportedMediaTypeException(
      "Tipo de archivo no admitido para almacenamiento.",
    );
  }

  return extension;
}
