import { z } from "zod";

/**
 * Metadatos de una carga de media. Llegan como campos de un formulario
 * multipart (todos string), por eso las dimensiones se coercionan. La regla
 * de dimensiones replica el CHECK `ck_media_dimensions` de la tabla
 * `media.files` (ambas presentes y positivas, o ambas ausentes).
 */
export const mediaUploadMetadataSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        "El código debe ser kebab-case en minúsculas.",
      ),
    name: z.string().trim().min(1).max(180),
    altText: z.string().trim().min(1).max(300),
    license: z.string().trim().min(1).max(160).default("Propietaria"),
    attribution: z.string().trim().max(500).default("GymSheet"),
    width: z.coerce.number().int().positive().max(100000).optional(),
    height: z.coerce.number().int().positive().max(100000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasWidth = value.width !== undefined;
    const hasHeight = value.height !== undefined;
    if (hasWidth !== hasHeight)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasWidth ? "height" : "width"],
        message: "width y height deben enviarse juntos o ninguno.",
      });
  });

export type MediaUploadMetadata = z.infer<typeof mediaUploadMetadataSchema>;

/** Listado del catálogo administrado; el tope evita respuestas ilimitadas. */
export const mediaListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
  .strict();

export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
