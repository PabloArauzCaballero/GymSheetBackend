import { z } from 'zod';

/**
 * Láminas en alta resolución (nitidez de portadas, 2026-10).
 *
 * Las láminas del catálogo vienen de `yuhonas/free-exercise-db` y miden
 * 850 × 567 px: no existe un original mayor (comprobado byte a byte contra el
 * repositorio de origen). Un teléfono a 3× necesita ≥ 1.206 px de ancho, así que
 * a sangre se veían ampliadas ×1,4–×2. La salida es reescalarlas FUERA del
 * backend (`tools/laminas-hd`, Real-ESRGAN) y cargar aquí el resultado: el
 * backend no procesa imágenes, solo valida la entrega y la guarda.
 */

/** Ancho mínimo para dar una lámina por nítida a sangre en un teléfono a 3×. */
export const HD_MIN_WIDTH = 1200;

export const hdManifestSchema = z
  .object({
    /** Cómo se generaron (modelo y escala), para la procedencia de cada fila. */
    generador: z.string().trim().min(1).max(120),
    laminas: z
      .array(
        z
          .object({
            /** `external_id` de la fila: `free-exercise-db:<Id>:<n>`. */
            externalId: z.string().trim().min(1).max(180),
            /** Ruta del archivo, relativa a la carpeta de la entrega. Sin subir de nivel. */
            archivo: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .regex(/^[A-Za-z0-9._-]+$/u, 'Solo un nombre de archivo, sin carpetas.'),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
            /** SHA-256 de la lámina de origen de la que salió; se guarda como procedencia. */
            origenSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();

export type HdManifest = z.infer<typeof hdManifestSchema>;

/**
 * Ancho y alto de un JPEG leyendo su cabecera (segmento SOF). El backend no
 * tiene librería de imágenes y no la necesita para esto: basta con no fiarse del
 * número que diga el manifiesto.
 */
export function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Relleno y marcadores sin longitud.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    // SOF0–SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}
