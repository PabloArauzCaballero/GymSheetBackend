import { z } from "zod";
import { CHAT_STICKER_IDS } from "./chat-sticker-catalog";
import { DISAPPEARING_SECONDS } from "./chat-disappearing";

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
    /** Nombre del lugar elegido en el mapa; solo tiene sentido con `type: "location"`. */
    locationLabel: z.string().trim().min(1).max(180).optional(),
    /** Responder citando: el mensaje citado, de esta misma conversación. */
    replyToId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "text" && !value.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "El mensaje no puede estar vacío." });
    }
    if (value.type === "location" && (value.locationLat === undefined || value.locationLng === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["locationLat"], message: "Falta la ubicación." });
    }
    if (value.type !== "location" && value.locationLabel !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["locationLabel"], message: "El nombre del lugar solo acompaña a una ubicación." });
    }
  });

/** Stickers only accept catalog IDs: no arbitrary URLs or alternate body. */
const sendStickerMessageSchema = z.object({
  type: z.literal("sticker"),
  stickerId: z.enum(CHAT_STICKER_IDS),
  clientRequestId: z.string().uuid().optional(),
  replyToId: z.string().uuid().optional(),
}).strict();

export const sendMessageSchema = z.union([sendTextOrLocationSchema, sendStickerMessageSchema]);

/** Metadata de un mensaje con adjunto — el archivo llega aparte, vía `FileInterceptor`. */
export const sendMediaMessageSchema = z.object({
  type: z.enum(["image", "video", "audio"]),
  body: z.string().trim().max(4000).optional(),
  viewOnce: z
    .preprocess((value) => (typeof value === "string" ? value === "true" : value), z.boolean())
    .default(false),
  /** Responder citando con una foto, video o nota de voz (campo multipart). */
  replyToId: z.string().uuid().optional(),
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

/** Mensajes temporales: `null` los desactiva; si no, 24 h, 7 días o 90 días en segundos. */
export const setDisappearingMessagesSchema = z.object({
  seconds: z.union([
    z.literal(DISAPPEARING_SECONDS[0]),
    z.literal(DISAPPEARING_SECONDS[1]),
    z.literal(DISAPPEARING_SECONDS[2]),
  ]).nullable(),
}).strict();
export type SetDisappearingMessagesInput = z.infer<typeof setDisappearingMessagesSchema>;

/**
 * Un emoji de verdad (o una secuencia: tono de piel, ZWJ, bandera, tecla):
 * solo se admiten piezas de emoji y al menos una tiene que ser pictográfica,
 * una bandera (dos indicadores regionales) o una tecla «1️⃣».
 */
const EMOJI_PIECES = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3)+$/u;
const EMOJI_ANCHOR = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\ufe0f?\u20e3/u;

export function isReactionEmoji(value: string): boolean {
  return value.length >= 1 && value.length <= 16 && EMOJI_PIECES.test(value) && EMOJI_ANCHOR.test(value);
}

/** Reaccionar a un mensaje: `null` quita la reacción propia. */
export const setReactionSchema = z.object({
  emoji: z.string().refine(isReactionEmoji, { message: "La reacción debe ser un emoji." }).nullable(),
}).strict();
export type SetReactionInput = z.infer<typeof setReactionSchema>;

/** Reenviar un mensaje de otra conversación (o de la misma) a `:id`. */
export const forwardMessageSchema = z.object({
  fromConversationId: z.string().uuid(),
  messageId: z.string().uuid(),
}).strict();
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;

/** «Escribiendo…» por socket: no se guarda, solo se difunde a la sala. */
export const typingSchema = z.object({
  conversationId: z.string().uuid(),
  typing: z.boolean(),
}).strict();
