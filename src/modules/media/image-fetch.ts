/**
 * Descarga SSRF-segura de una imagen remota para mirroring a nuestro storage.
 *
 * Reglas (alineadas con el cliente del dataset de ejercicios):
 *  - solo https;
 *  - host en allowlist explícita (sin usuario/clave ni puerto);
 *  - `redirect: "error"` para bloquear SSRF por redirección;
 *  - content-type debe ser `image/*`;
 *  - tope de bytes y timeout por AbortController.
 * Fuerza `Accept: image/jpeg,image/png` para evitar la negociación a AVIF/WebP
 * que rompe imágenes en clientes que no soportan esos formatos: se guarda un
 * raster de máxima compatibilidad (JPEG/PNG).
 */
const ACCEPT_RASTER = "image/jpeg,image/png";

export interface FetchedImage {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

export interface FetchImageOptions {
  readonly allowedHosts: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export function assertAllowedImageUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL de imagen inválida: ${rawUrl}`);
  }
  if (url.protocol !== "https:")
    throw new Error(`La URL de imagen debe ser https: ${rawUrl}`);
  if (url.username || url.password || url.port)
    throw new Error(`La URL de imagen no admite credenciales ni puerto: ${rawUrl}`);
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.map((entry) => entry.toLowerCase()).includes(host))
    throw new Error(`Host no permitido para mirroring: ${host}`);
  return url;
}

export async function fetchImage(
  rawUrl: string,
  options: FetchImageOptions,
): Promise<FetchedImage> {
  const url = assertAllowedImageUrl(rawUrl, options.allowedHosts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: ACCEPT_RASTER },
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status} al descargar ${url.hostname}`);
    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mimeType.startsWith("image/"))
      throw new Error(`Contenido no es imagen (content-type: ${mimeType || "?"}).`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes)
      throw new Error(`Imagen excede ${options.maxBytes} bytes.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > options.maxBytes)
      throw new Error(`Imagen excede ${options.maxBytes} bytes.`);
    return { buffer, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}
