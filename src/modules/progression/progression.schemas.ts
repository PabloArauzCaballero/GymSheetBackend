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
 * Nivel al que se escribe la fila. El gimnasio concreto NO viaja aquí: sale del
 * token. Antes este contrato aceptaba un `tenantId` en el cuerpo, y con eso
 * bastaba para escribir en el catálogo de cualquier otro gimnasio.
 *
 * Sin valor por defecto a propósito: quien puede elegir nivel (la plataforma)
 * tiene que decirlo, porque una fila global creada por descuido aparece en
 * todos los gimnasios. Ver `resolveCatalogTenant`.
 */
const alcanceSchema = z.literal("GLOBAL").optional();

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
  alcance: alcanceSchema,
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

/**
 * `alcance` queda fuera de la edicion: el nivel de una fila se fija al
 * crearla. Admitir el cambio convertiria un PATCH en una mudanza entre
 * gimnasios, que es precisamente el movimiento que el alcance existe para
 * impedir.
 */
export const updateLevelSchema = createLevelSchema
  .omit({ alcance: true })
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
  alcance: alcanceSchema,
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

/**
 * `alcance` queda fuera de la edicion: el nivel de una fila se fija al
 * crearla. Admitir el cambio convertiria un PATCH en una mudanza entre
 * gimnasios, que es precisamente el movimiento que el alcance existe para
 * impedir.
 */
export const updateBadgeSchema = createBadgeSchema
  .omit({ alcance: true })
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Debe enviar al menos un campo para actualizar.",
  });

/**
 * Días de la semana (ISO: 1 lunes ... 7 domingo) que el usuario declara como
 * descanso planificado. Como máximo seis: si los siete fueran descanso la
 * racha nunca podría romperse, y dejaría de significar nada.
 */
export const restDaysSchema = z.object({
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .max(6, "No puedes marcar los siete días como descanso.")
    .refine((values) => new Set(values).size === values.length, {
      message: "Cada día solo puede aparecer una vez.",
    }),
});

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  /** Orden de la clasificación: por puntos totales o por racha vigente. */
  sortBy: z.enum(["points", "streak"]).default("points"),
});

export type CreateLevelInput = z.infer<typeof createLevelSchema>;
export type UpdateLevelInput = z.infer<typeof updateLevelSchema>;
export type CreateBadgeInput = z.infer<typeof createBadgeSchema>;
export type UpdateBadgeInput = z.infer<typeof updateBadgeSchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type RestDaysInput = z.infer<typeof restDaysSchema>;
