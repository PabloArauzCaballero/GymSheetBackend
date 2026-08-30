import { ConversationSummaryRow, SystemConversationKind } from "./chat.repository";
import { MessageModel, MessageType } from "./message.model";

export type MessageResponse = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  type: MessageType;
  /** `null` si es vista única y ya se abrió (o si esta respuesta no es la de apertura). */
  mediaUrl: string | null;
  mediaMimeType: string | null;
  viewOnce: boolean;
  /** Solo tiene sentido cuando `viewOnce` es `true`. */
  viewed: boolean;
  locationLat: number | null;
  locationLng: number | null;
  createdAt: Date;
};

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
  { revealViewOnce = false }: { revealViewOnce?: boolean } = {},
): MessageResponse {
  const mediaLocked = message.viewOnce && !revealViewOnce;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    type: message.type,
    mediaUrl: mediaLocked ? null : message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    viewOnce: message.viewOnce,
    viewed: Boolean(message.viewedAt),
    locationLat: message.locationLat,
    locationLng: message.locationLng,
    createdAt: message.createdAt,
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
  };
}
