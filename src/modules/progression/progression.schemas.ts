import { z } from "zod";

/**
 * Contratos de la API de administración del catálogo.
 *
 * La pantalla de administración todavía no existe: estos endpoints se entregan
 * hechos y sembrados para que el trabajo de interfaz de otra sesión no tenga
 * que tocar el backend. Por eso los esquemas son estrictos aunque hoy nadie los
 * llame desde una interfaz: son el contrato que esa pantalla va a asumir.
 */

const audienceSchema = z.enum(["ANY", "MALE", "FEMALE"]);

/**
 * Nulo = catálogo global, para todos los gimnasios. Es el valor por defecto a
 * propósito: la progresión debe funcionar igual sin importar el inquilino, y
 * declarar un gimnasio es la excepción, no la norma.
 */
const tenantIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "El identificador del gimnasio debe ir en minúsculas.")
  .max(60)
  .nullable();

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "El color debe ser hexadecimal (#rrggbb).");

/** Nombre de icono de Ionicons; ambos clientes usan ese mismo juego. */
const iconSchema = z.string().trim().min(2).max(60);

const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]*$/, "El código debe ir en mayúsculas con guiones bajos.")
  .max(60);

export const createLevelSchema = z.object({
  tenantId: tenantIdSchema.default(null),
  audience: audienceSchema.default("ANY"),
  code: codeSchema,
  name: z.string().trim().min(2).max(80),
  tagline: z.string().trim().min(4).max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  minPoints: z.number().int().min(0).max(10_000_000),
  sortOrder: z.number().int().min(1).max(1000),
  icon: iconSchema.default("flame-outline"),
  color: colorSchema.default("#c3f400"),
  active: z.boolean().default(true),
});

export const updateLevelSchema = createLevelSchema
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Debe enviar al menos un campo para actualizar.",
  });

export const criterionTypeSchema = z.enum([
  "SESSION_COUNT",
  "STREAK_DAYS",
  "WEEKLY_STREAK",
  "TOTAL_VOLUME_KG",
  "SINGLE_SESSION_VOLUME_KG",
  "TOTAL_SETS",
  "TOTAL_REPS",
  "DISTINCT_MUSCLE_GROUPS",
  "DISTINCT_EXERCISES",
  "EARLY_SESSIONS",
  "NIGHT_SESSIONS",
  "WEEKEND_SESSIONS",
  "PERSONAL_RECORDS",
]);

export const createBadgeSchema = z.object({
  tenantId: tenantIdSchema.default(null),
  audience: audienceSchema.default("ANY"),
  code: codeSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(4).max(300),
  flavorText: z.string().trim().max(300).nullable().default(null),
  category: z.enum(["CONSTANCIA", "VOLUMEN", "FUERZA", "VARIEDAD", "HITO", "SECRETA"]),
  rarity: z.enum(["COMUN", "RARA", "EPICA", "LEGENDARIA"]).default("COMUN"),
  icon: iconSchema.default("ribbon-outline"),
  color: colorSchema.default("#c3f400"),
  criterionType: criterionTypeSchema,
  criterionThreshold: z.number().positive().max(100_000_000),
  pointsReward: z.number().int().min(0).max(100_000).default(0),
  secret: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const updateBadgeSchema = createBadgeSchema
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Debe enviar al menos un campo para actualizar.",
  });

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type CreateLevelInput = z.infer<typeof createLevelSchema>;
export type UpdateLevelInput = z.infer<typeof updateLevelSchema>;
export type CreateBadgeInput = z.infer<typeof createBadgeSchema>;
export type UpdateBadgeInput = z.infer<typeof updateBadgeSchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
