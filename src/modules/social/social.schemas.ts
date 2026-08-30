import { z } from "zod";
import { SocialStatus } from "../../common/enums/domain.enums";

export const sendConnectionSchema = z.object({
  addresseeId: z.string().uuid(),
});

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

export type SendConnectionInput = z.infer<typeof sendConnectionSchema>;
export type RespondConnectionInput = z.infer<typeof respondConnectionSchema>;
export type ConnectionListQuery = z.infer<typeof connectionListQuerySchema>;
export type UpdateSocialStatusInput = z.infer<typeof updateSocialStatusSchema>;
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
