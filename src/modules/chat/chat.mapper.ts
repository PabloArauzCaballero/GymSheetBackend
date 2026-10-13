import { ConversationSummaryRow, SystemConversationKind } from "./chat.repository";
import { MessageModel, MessageType } from "./message.model";

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
  createdAt: Date;
  /** Clients display «Editado» when present. */
  editedAt: Date | null;
  deletedAt: Date | null;
};

export type SystemChatEventResponse = {
  id: string;
  conversationId: string;
  senderId: null;
  type: "system";
  systemEvent: {
    kind: "TRAINING_INVITE_ACCEPTED";
    invitationId: string;
    acceptedRevision: number;
    startsAt: string;
    timeZone: string;
    placeLabel: string;
  };
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
    },
    createdAt: new Date(event.createdAt),
  };
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
  { revealViewOnce = false, storyAvailable }: { revealViewOnce?: boolean; storyAvailable?: boolean } = {},
): MessageResponse {
  if (message.deletedAt) return {
    id: message.id, conversationId: message.conversationId, senderId: message.senderId,
    clientRequestId: message.clientRequestId ?? null, body: "Mensaje eliminado", type: "text",
    stickerId: null, storyReference: null, mediaUrl: null, mediaMimeType: null, viewOnce: false, viewed: false,
    locationLat: null, locationLng: null, createdAt: message.createdAt, editedAt: null,
    deletedAt: message.deletedAt,
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
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null,
    deletedAt: null,
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
};

export function mapConversationSummary(
  row: ConversationSummaryRow,
  otherUserOnline: boolean,
): ConversationSummaryResponse {
  return {
    conversationId: row.conversation_id,
    otherUserId: row.other_user_id,
    otherUserName: row.other_user_name,
    otherUserPhotoUrl: row.other_user_photo_url,
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
  };
}
