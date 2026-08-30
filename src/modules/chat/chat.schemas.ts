import { z } from "zod";

export const startConversationSchema = z.object({
  otherUserId: z.string().uuid(),
});

/**
 * Texto o ubicación, por REST (`POST .../messages`). Foto/video van por
 * `POST .../messages/media` (multipart) — ver `sendMediaMessageSchema` — y el
 * socket (`message:send`) solo habla texto, sin pasar por este schema.
 */
export const sendMessageSchema = z
  .object({
    type: z.enum(["text", "location"]).default("text"),
    body: z.string().trim().max(4000).optional(),
    locationLat: z.number().min(-90).max(90).optional(),
    locationLng: z.number().min(-180).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "text" && !value.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "El mensaje no puede estar vacío." });
    }
    if (value.type === "location" && (value.locationLat === undefined || value.locationLng === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["locationLat"], message: "Falta la ubicación." });
    }
  });

/** Metadata de un mensaje con adjunto — el archivo llega aparte, vía `FileInterceptor`. */
export const sendMediaMessageSchema = z.object({
  type: z.enum(["image", "video"]),
  body: z.string().trim().max(4000).optional(),
  viewOnce: z
    .preprocess((value) => (typeof value === "string" ? value === "true" : value), z.boolean())
    .default(false),
});

export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Trae mensajes anteriores a este, para scroll hacia atrás. */
  before: z.string().datetime().optional(),
});

/** `null` borra el apodo y vuelve a mostrar el nombre real. */
export const setNicknameSchema = z.object({
  nickname: z.string().trim().min(1).max(60).nullable(),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendMediaMessageInput = z.infer<typeof sendMediaMessageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type SetNicknameInput = z.infer<typeof setNicknameSchema>;
