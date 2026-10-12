import { z } from 'zod';

/**
 * Láminas abiertas emparejadas a mano (cierre de Rutinas, 2026-10).
 *
 * La importación diaria solo cuelga una lámina de `free-exercise-db` cuando el
 * nombre coincide con el del catálogo, y los dos catálogos llaman distinto a lo
 * mismo («sled 45° leg press» y «Leg Press»): 79 de los 117 ejercicios de las
 * rutinas de muestra se quedaban sin imagen teniendo una foto libre equivalente.
 * `tools/laminas-abiertas/fuentes.json` es la tabla de equivalencias revisada a
 * ojo, y esto carga la entrega que sale de ella. El backend no descarga ni
 * procesa imágenes: valida y guarda.
 */

/** Qué tan fiel es la foto al ejercicio; va a `metadata` para poder retirarlas por nivel. */
export const OPEN_STILL_MATCHES = ['exacta', 'variante', 'implemento'] as const;

export const openStillsManifestSchema = z
  .object({
    generador: z.string().trim().min(1).max(120),
    fuente: z.string().trim().min(1).max(120),
    autor: z.string().trim().min(1).max(200),
    licencia: z.string().trim().min(1).max(160),
    licenciaUrl: z.string().url().max(300),
    laminas: z
      .array(
        z
          .object({
            /** `external_id` del ejercicio en el catálogo. */
            ejercicio: z.string().trim().min(1).max(60),
            /** Nombre inglés exacto del catálogo: si no coincide, la carga falla. */
            en: z.string().trim().min(1).max(200),
            /** `external_id` de la fila de medio: `free-exercise-db:<Id>:<n>`. */
            externalId: z.string().trim().min(1).max(180),
            archivo: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .regex(/^[A-Za-z0-9._-]+$/u, 'Solo un nombre de archivo, sin carpetas.'),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
            origenSha256: z.string().regex(/^[0-9a-f]{64}$/u),
            origenUrl: z.string().url().max(400),
            coincidencia: z.enum(OPEN_STILL_MATCHES),
            nota: z.string().trim().max(300).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();

export type OpenStillsManifest = z.infer<typeof openStillsManifestSchema>;
