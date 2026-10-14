import { z } from "zod";
import { CHAT_STICKER_IDS } from "./chat-sticker-catalog";

export const startConversationSchema = z.object({
  otherUserId: z.string().uuid(),
});

/**
 * Texto, ubicación o sticker de catálogo, por REST (`POST .../messages`). Foto/video van por
 * `POST .../messages/media` (multipart) — ver `sendMediaMessageSchema` — y el
 * socket (`message:send`) solo habla texto, sin pasar por este schema.
 */
const sendTextOrLocationSchema = z
  .object({
    type: z.enum(["text", "location"]).default("text"),
    body: z.string().trim().max(4000).optional(),
    clientRequestId: z.string().uuid().optional(),
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

/** Stickers only accept catalog IDs: no arbitrary URLs or alternate body. */
const sendStickerMessageSchema = z.object({
  type: z.literal("sticker"),
  stickerId: z.enum(CHAT_STICKER_IDS),
  clientRequestId: z.string().uuid().optional(),
}).strict();

export const sendMessageSchema = z.union([sendTextOrLocationSchema, sendStickerMessageSchema]);

/** Metadata de un mensaje con adjunto — el archivo llega aparte, vía `FileInterceptor`. */
export const sendMediaMessageSchema = z.object({
  type: z.enum(["image", "video", "audio"]),
  body: z.string().trim().max(4000).optional(),
  viewOnce: z
    .preprocess((value) => (typeof value === "string" ? value === "true" : value), z.boolean())
    .default(false),
});

export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Trae mensajes anteriores a este, para scroll hacia atrás. */
  before: z.string().datetime().optional(),
  /** Desempata la fecha del cursor para paginar mensajes y eventos sin saltos. */
  beforeId: z.string().uuid().optional(),
});

/** `null` borra el apodo y vuelve a mostrar el nombre real. */
export const setNicknameSchema = z.object({
  nickname: z.string().trim().min(1).max(60).nullable(),
});

export const readReceiptSettingsQuerySchema = z.object({ conversationId: z.string().uuid().optional() });

export const updateReadReceiptSettingsSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("ALL"), enabled: z.boolean(), expectedVersion: z.number().int().nonnegative() }),
  z.object({ scope: z.literal("CONVERSATION"), conversationId: z.string().uuid(), enabled: z.boolean(), expectedVersion: z.number().int().nonnegative() }),
  z.object({ scope: z.literal("SELECTED"), conversationIds: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length), enabled: z.boolean(), expectedVersion: z.number().int().nonnegative() }),
]);

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendMediaMessageInput = z.infer<typeof sendMediaMessageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type SetNicknameInput = z.infer<typeof setNicknameSchema>;
export type ReadReceiptSettingsQuery = z.infer<typeof readReceiptSettingsQuerySchema>;
export type UpdateReadReceiptSettingsInput = z.infer<typeof updateReadReceiptSettingsSchema>;

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
}).strict();
export type EditMessageInput = z.infer<typeof editMessageSchema>;

/** Local hiding or author-only global tombstone. */
export const deleteMessageSchema = z.object({ scope: z.enum(["ME", "EVERYONE"]) }).strict();
export type DeleteMessageInput = z.infer<typeof deleteMessageSchema>;
