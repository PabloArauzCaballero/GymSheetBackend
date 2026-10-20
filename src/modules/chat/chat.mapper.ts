import { ConversationSummaryRow, DisappearingTimerEvent, SystemConversationKind } from "./chat.repository";
import { MessageModel, MessageType } from "./message.model";
import { isExpired } from "./chat-disappearing";
import { resolveMediaUrl } from "../../common/media/media-url";

/** Lo que se ve de la cita dentro de la burbuja de una respuesta. */
export type ReplyPreview = {
  messageId: string;
  senderId: string;
  type: MessageType;
  /** Texto corto de la cita; `null` para audio, sticker, vista única o si el original ya no está. */
  body: string | null;
  /** `false` si el original se eliminó para todos, caducó o quien lee lo ocultó. */
  available: boolean;
};

export type MessageReaction = { userId: string; emoji: string };

/** Cita y reacciones de un mensaje, resueltas en lote por el repositorio. */
export type MessageExtras = { replyTo: ReplyPreview | null; reactions: MessageReaction[] };

const REPLY_PREVIEW_MAX = 200;

/**
 * La cita de una respuesta. `target` ausente = el original se purgó (o no es
 * respuesta): no hay cita que dibujar. Un original que ya no se puede ver
 * conserva quién y qué tipo era, pero nunca su contenido.
 */
export function replyPreviewOf(
  target: Pick<MessageModel, "id" | "senderId" | "type" | "body" | "viewOnce" | "locationLabel" | "deletedAt" | "expiresAt"> | undefined,
  hiddenForViewer: boolean,
  now: Date = new Date(),
): ReplyPreview | null {
  if (!target) return null;
  const base = { messageId: target.id, senderId: target.senderId, type: target.type };
  if (target.deletedAt || isExpired({ expiresAt: target.expiresAt ?? null }, now) || hiddenForViewer) {
    return { ...base, body: null, available: false };
  }
  return { ...base, body: replyBodyOf(target), available: true };
}

function replyBodyOf(target: Pick<MessageModel, "type" | "body" | "viewOnce" | "locationLabel">): string | null {
  if (target.viewOnce) return null;
  if (target.type === "location") return target.locationLabel ?? null;
  if (target.type === "audio" || target.type === "sticker") return null;
  const body = target.body?.trim() ?? "";
  if (!body) return null;
  return body.length > REPLY_PREVIEW_MAX ? `${body.slice(0, REPLY_PREVIEW_MAX - 1)}…` : body;
}

export type MessageResponse = {
  id: string;
  conversationId: string;
  senderId: string;
  clientRequestId: string | null;
  body: string | null;
  type: MessageType;
  storyReference: { storyId: string; available: boolean } | null;
  /** Stable catalog ID; clients resolve their bundled sticker asset. */
  stickerId: string | null;
  /** `null` si es vista única y ya se abrió (o si esta respuesta no es la de apertura). */
  mediaUrl: string | null;
  mediaMimeType: string | null;
  viewOnce: boolean;
  /** Solo tiene sentido cuando `viewOnce` es `true`. */
  viewed: boolean;
  locationLat: number | null;
  locationLng: number | null;
  /** Nombre del lugar elegido en el mapa; `null` para «mi ubicación actual» y otros tipos. */
  locationLabel: string | null;
  /** Mensaje temporal: a esta hora deja de verse para ambos. */
  expiresAt: Date | null;
  createdAt: Date;
  /** Clients display «Editado» when present. */
  editedAt: Date | null;
  deletedAt: Date | null;
  /** Mensaje citado al responder; `null` si no es respuesta o el original se purgó. */
  replyTo: ReplyPreview | null;
  /** Una reacción por persona, en el orden en que llegaron. */
  reactions: MessageReaction[];
  /** Copia de un mensaje de otra conversación («Reenviado»). */
  forwarded: boolean;
};

export type TrainingInviteAcceptedSystemEvent = {
  kind: "TRAINING_INVITE_ACCEPTED";
  invitationId: string;
  acceptedRevision: number;
  startsAt: string;
  timeZone: string;
  placeLabel: string;
  cancelledAt?: string;
};

/** «X activó los mensajes temporales: 7 días» / «X los desactivó» (`seconds: null`). */
export type DisappearingMessagesSystemEvent = {
  kind: "DISAPPEARING_MESSAGES_CHANGED";
  seconds: number | null;
  changedByUserId: string | null;
};

export type SystemChatEventResponse = {
  id: string;
  conversationId: string;
  senderId: null;
  type: "system";
  systemEvent: TrainingInviteAcceptedSystemEvent | DisappearingMessagesSystemEvent;
  createdAt: Date;
};

export type ChatHistoryItem = MessageResponse | SystemChatEventResponse;

export function mapTrainingInviteEvent(event: {
  id: string;
  conversationId: string;
  invitationId: string;
  acceptedRevision: number;
  startsAt: Date;
  timeZone: string;
  placeLabel: string;
    cancelledAt?: Date | null;
  createdAt: Date;
}): SystemChatEventResponse {
  return {
    id: event.id,
    conversationId: event.conversationId,
    senderId: null,
    type: "system",
    systemEvent: {
      kind: "TRAINING_INVITE_ACCEPTED",
      invitationId: event.invitationId,
      acceptedRevision: event.acceptedRevision,
      startsAt: new Date(event.startsAt).toISOString(),
      timeZone: event.timeZone,
      placeLabel: event.placeLabel,
      ...(event.cancelledAt ? { cancelledAt: new Date(event.cancelledAt).toISOString() } : {}),
    },
    createdAt: new Date(event.createdAt),
  };
}

export function mapDisappearingTimerEvent(event: DisappearingTimerEvent): SystemChatEventResponse {
  return {
    id: event.id,
    conversationId: event.conversationId,
    senderId: null,
    type: "system",
    systemEvent: {
      kind: "DISAPPEARING_MESSAGES_CHANGED",
      seconds: event.seconds,
      changedByUserId: event.changedByUserId,
    },
    createdAt: new Date(event.createdAt),
  };
}

export function mapChatHistoryItem(record: {
  kind: "system";
  event: Parameters<typeof mapTrainingInviteEvent>[0];
}): SystemChatEventResponse {
  return mapTrainingInviteEvent(record.event);
}

/**
 * `revealViewOnce`: solo lo pasa en `true` el endpoint de "abrir" un mensaje
 * de vista única, justo después de marcarlo visto — es la única respuesta que
 * lleva la URL real. Cualquier otra ruta (historial, `message:new`) la oculta.
 *
 * No vuelve a mirar `viewedAt` para decidir el bloqueo: `ChatService.viewMessage`
 * ya rechazó la apertura si el mensaje venía visto *antes* de esta llamada, así
 * que `revealViewOnce: true` siempre corresponde a la revelación legítima —
 * aunque el registro que llega acá ya tenga `viewedAt` recién puesto.
 */
export function mapMessageToResponse(
  message: MessageModel,
  {
    revealViewOnce = false,
    storyAvailable,
    extras,
  }: { revealViewOnce?: boolean; storyAvailable?: boolean; extras?: MessageExtras } = {},
): MessageResponse {
  if (message.deletedAt) return {
    id: message.id, conversationId: message.conversationId, senderId: message.senderId,
    clientRequestId: message.clientRequestId ?? null, body: "Mensaje eliminado", type: "text",
    stickerId: null, storyReference: null, mediaUrl: null, mediaMimeType: null, viewOnce: false, viewed: false,
    locationLat: null, locationLng: null, locationLabel: null, expiresAt: message.expiresAt ?? null,
    createdAt: message.createdAt, editedAt: null,
    deletedAt: message.deletedAt, replyTo: null, reactions: [], forwarded: false,
  };
  const mediaLocked = message.viewOnce && !revealViewOnce;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    clientRequestId: message.clientRequestId ?? null,
    body: message.body,
    type: message.type,
    stickerId: message.type === "sticker" ? message.body : null,
    storyReference: message.storyId ? { storyId: message.storyId, available: storyAvailable ?? true } : null,
    mediaUrl: mediaLocked || !message.mediaKey
      ? null
      : `/me/conversations/${message.conversationId}/messages/${message.id}/media`,
    mediaMimeType: message.mediaMimeType,
    viewOnce: message.viewOnce,
    viewed: Boolean(message.viewedAt),
    locationLat: message.locationLat,
    locationLng: message.locationLng,
    locationLabel: message.type === "location" ? message.locationLabel ?? null : null,
    expiresAt: message.expiresAt ?? null,
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null,
    deletedAt: null,
    replyTo: extras?.replyTo ?? null,
    reactions: extras?.reactions ?? [],
    forwarded: message.forwarded ?? false,
  };
}

export type ConversationSummaryResponse = {
  conversationId: string;
  otherUserId: string;
  otherUserName: string;
  otherUserPhotoUrl: string | null;
  otherUserOnline: boolean;
  otherUserLastSeenAt: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  canWrite: boolean;
  systemKind: SystemConversationKind | null;
  /** Apodo propio para esta conversación (privado), o `null` si no se puso ninguno. */
  nickname: string | null;
  /** Cursores del otro participante: comparar contra `createdAt` de mis mensajes para pintar el check. */
  otherUserLastDeliveredAt: string | null;
  otherUserLastReadAt: string | null;
  otherUserReadReceiptsSinceAt: string | null;
  /** Mensajes temporales vigentes (segundos); `null` = desactivados. */
  disappearingSeconds: number | null;
};

export function mapConversationSummary(
  row: ConversationSummaryRow,
  otherUserOnline: boolean,
): ConversationSummaryResponse {
  return {
    conversationId: row.conversation_id,
    otherUserId: row.other_user_id,
    otherUserName: row.other_user_name,
    otherUserPhotoUrl: resolveMediaUrl(row.other_user_photo_url),
    otherUserOnline,
    otherUserLastSeenAt: row.other_user_last_seen_at,
    lastMessage: row.last_message_body,
    lastMessageAt: row.last_message_at,
    canWrite: row.can_write,
    systemKind: row.system_kind,
    nickname: row.nickname,
    otherUserLastDeliveredAt: row.other_last_delivered_at,
    otherUserLastReadAt: row.other_last_read_at,
    otherUserReadReceiptsSinceAt: row.other_read_receipts_enabled_since instanceof Date
      ? row.other_read_receipts_enabled_since.toISOString()
      : row.other_read_receipts_enabled_since,
    disappearingSeconds: row.disappearing_seconds ?? null,
  };
}
