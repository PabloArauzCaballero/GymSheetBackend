import { z } from "zod";
import { SocialStatus } from "../../common/enums/domain.enums";

export const sendConnectionSchema = z.object({
  addresseeId: z.string().uuid(),
});

export const socialBlockSchema = z.object({ targetUserId: z.string().uuid() });

export const respondConnectionSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
});

export const connectionListQuerySchema = z.object({
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]).optional(),
});

export const updateSocialStatusSchema = z.object({
  socialStatus: z.nativeEnum(SocialStatus).nullable(),
  visible: z.boolean(),
});

export const updateSocialDiscoverySettingsSchema = z
  .object({
    profileEnabled: z.boolean(),
    crossGymEnabled: z.boolean(),
    mapEnabled: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (settings) =>
      settings.profileEnabled ||
      (!settings.crossGymEnabled && !settings.mapEnabled),
    {
      message:
        "El perfil social debe estar activo para aparecer en otros gimnasios o en el mapa.",
    },
  );

export const discoveryPreferencesInputSchema = z
  .object({
    genders: z
      .array(z.enum(["MALE", "FEMALE"]))
      .min(1)
      .max(2),
    intents: z
      .array(z.enum(["TRAINING", "FRIENDSHIP", "DATING"]))
      .min(1)
      .max(3),
    minAge: z.number().int().min(18).max(100),
    maxAge: z.number().int().min(18).max(100),
    radiusKm: z.number().finite().min(1).max(500),
    flexibleAge: z.boolean(),
    flexibleDistance: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .superRefine((preferences, context) => {
    if (preferences.minAge > preferences.maxAge) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAge"],
        message: "La edad máxima debe ser igual o mayor a la mínima.",
      });
    }
    if (new Set(preferences.genders).size !== preferences.genders.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["genders"],
        message: "No se permiten géneros duplicados.",
      });
    }
    if (new Set(preferences.intents).size !== preferences.intents.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intents"],
        message: "No se permiten intenciones duplicadas.",
      });
    }
  });

export type DiscoveryPreferencesInput = z.infer<
  typeof discoveryPreferencesInputSchema
>;

/**
 * Directorio del gimnasio: quién más entrena ahí, filtrable por objetivo,
 * sucursal (`usuarios.sede_id`, no la preferencia de horario del onboarding)
 * y género.
 */
export const directoryQuerySchema = z.object({
  objetivo: z.string().trim().max(40).optional(),
  sucursalId: z.string().uuid().optional(),
  genero: z.enum(["MALE", "FEMALE"]).optional(),
  /** Búsqueda por nombre, dentro del mismo tenant que el resto del directorio. */
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * La baraja de descubrimiento: los mismos filtros del directorio, porque es el
 * mismo catálogo de socios visto de otra forma. El tope es más bajo (30) porque
 * una baraja se consume de una en una: pedir cincuenta cartas es traer cuarenta
 * que se van a tirar.
 */
export const discoveryDeckQuerySchema = directoryQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(30).default(10),
  cursor: z.string().min(1).max(12_000).optional(),
});

/** Un swipe: «me gusta» o «paso» sobre una carta de la baraja. */
export const swipeSchema = z.object({
  targetId: z.string().uuid(),
  direction: z.enum(["LIKE", "PASS"]),
  impressionId: z.string().uuid().optional(),
});

export const discoveryImpressionSchema = z.object({
  impressionId: z.string().uuid(),
});

/**
 * Las listas de interacciones (likes y nexts, en las dos direcciones).
 *
 * Sin cursor a propósito: son listas cortas por naturaleza —los likes
 * pendientes se responden y desaparecen— y paginar algo que casi nunca pasa de
 * una pantalla es complejidad que no se cobra. El tope duro es 50.
 */
export const interactionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SendConnectionInput = z.infer<typeof sendConnectionSchema>;
export type SocialBlockInput = z.infer<typeof socialBlockSchema>;
export type RespondConnectionInput = z.infer<typeof respondConnectionSchema>;
export type ConnectionListQuery = z.infer<typeof connectionListQuerySchema>;
export type UpdateSocialStatusInput = z.infer<typeof updateSocialStatusSchema>;
export type UpdateSocialDiscoverySettingsInput = z.infer<
  typeof updateSocialDiscoverySettingsSchema
>;
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
export type DiscoveryDeckQuery = z.infer<typeof discoveryDeckQuerySchema>;
export type SwipeInput = z.infer<typeof swipeSchema>;
export type InteractionListQuery = z.infer<typeof interactionListQuerySchema>;
