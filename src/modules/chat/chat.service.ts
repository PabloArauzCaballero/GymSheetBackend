import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import { SocialService } from "../social/social.service";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { mapConversationSummary, mapMessageToResponse, MessageResponse } from "./chat.mapper";
import { MessageCreateFields, ChatRepository } from "./chat.repository";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { SystemChatService } from "./system-chat.service";

/** Shape de Multer `memoryStorage`, mismo contrato que usa `profile-photos`. */
export interface UploadedChatMedia {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly socialService: SocialService,
    private readonly chatEvents: ChatEventsService,
    private readonly presence: ChatPresenceService,
    private readonly systemChat: SystemChatService,
    private readonly usersRepository: UsersRepository,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly mediaStorage: MediaStorageProvider,
  ) {}

  /**
   * El chat solo tiene sentido entre personas conectadas — es la regla que
   * hace que este método sea el único punto de entrada real: tanto el REST
   * como el gateway de sockets pasan por aquí antes de tocar una conversación.
   * El chequeo de tenant es defensa en profundidad: `sendConnection` ya no
   * deja crear conexiones cross-tenant, pero esto cubre conexiones antiguas.
   */
  async getOrStartConversation(
    userId: string,
    tenantId: string,
    otherUserId: string,
  ): Promise<string> {
    if (userId === otherUserId) {
      throw new ForbiddenException("No puedes chatear contigo mismo.");
    }
    const connected = await this.socialService.isConnected(userId, otherUserId);
    if (!connected) {
      throw new ForbiddenException("Solo puedes chatear con conexiones aceptadas.");
    }
    const other = await this.usersRepository.findActiveById(otherUserId);
    const otherTenantId = other?.tenantId ?? env.DEFAULT_TENANT_ID;
    if (otherTenantId !== tenantId) {
      throw new ForbiddenException("Solo puedes chatear con conexiones aceptadas.");
    }
    const existing = await this.repository.findDirectConversation(userId, otherUserId);
    if (existing) return existing;
    return this.repository.createDirectConversation(userId, otherUserId);
  }

  async assertParticipant(conversationId: string, userId: string): Promise<ConversationParticipantModel> {
    const participant = await this.repository.getParticipant(conversationId, userId);
    // 404, no 403: una conversación ajena no debe confirmar que existe.
    if (!participant) throw new NotFoundException("Conversación no encontrada.");
    return participant;
  }

  async listConversations(userId: string) {
    const user = await this.usersRepository.findActiveById(userId);
    const tenantId = user?.tenantId ?? env.DEFAULT_TENANT_ID;
    await this.systemChat.ensureSystemConversations(userId, tenantId);
    const rows = await this.repository.listConversationsForUser(userId);
    return rows.map((row) => mapConversationSummary(row, this.presence.isOnline(row.other_user_id)));
  }

  async listMessages(conversationId: string, userId: string, limit: number, before?: string) {
    await this.assertParticipant(conversationId, userId);
    const messages = await this.repository.listMessages(conversationId, limit, before);
    // Traer el historial es, como mínimo, haberlo recibido: adelanta el
    // cursor de entregado aunque el socket nunca haya estado conectado.
    await this.markDelivered(conversationId, userId);
    return messages.map((message) => mapMessageToResponse(message));
  }

  /** Único punto que realmente escribe un mensaje — cada `send*` público arma los campos y pasa por acá. */
  private async persistMessage(
    conversationId: string,
    senderId: string,
    fields: MessageCreateFields,
  ): Promise<MessageResponse> {
    const participant = await this.assertParticipant(conversationId, senderId);
    if (!participant.canWrite) {
      throw new ForbiddenException("Esta conversación es de solo lectura.");
    }
    const message = await this.repository.createMessage(conversationId, senderId, fields);
    const response = mapMessageToResponse(message);
    this.chatEvents.emitMessage(response);
    return response;
  }

  async sendMessage(conversationId: string, senderId: string, body: string): Promise<MessageResponse> {
    return this.persistMessage(conversationId, senderId, { type: "text", body });
  }

  async sendLocationMessage(
    conversationId: string,
    senderId: string,
    location: { lat: number; lng: number },
  ): Promise<MessageResponse> {
    return this.persistMessage(conversationId, senderId, {
      type: "location",
      locationLat: location.lat,
      locationLng: location.lng,
    });
  }

  async sendMediaMessage(
    conversationId: string,
    senderId: string,
    file: UploadedChatMedia | undefined,
    options: { type: "image" | "video"; body?: string; viewOnce: boolean },
  ): Promise<MessageResponse> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException("Se requiere un archivo no vacío.");
    }
    if (file.size > env.CHAT_MEDIA_MAX_BYTES) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo de ${env.CHAT_MEDIA_MAX_BYTES} bytes.`,
      );
    }
    const mimeType = file.mimetype.toLowerCase();
    if (!env.CHAT_MEDIA_ALLOWED_MIME.includes(mimeType)) {
      throw new BadRequestException("Tipo de archivo no admitido.");
    }
    // Verificado antes de subir: no tiene sentido pagar la subida a storage
    // para una conversación a la que el remitente no puede escribir.
    const participant = await this.assertParticipant(conversationId, senderId);
    if (!participant.canWrite) {
      throw new ForbiddenException("Esta conversación es de solo lectura.");
    }

    const stored = await this.mediaStorage.upload({
      originalName: file.originalname,
      mimeType,
      sizeBytes: file.size,
      buffer: file.buffer,
    });

    return this.persistMessage(conversationId, senderId, {
      type: options.type,
      body: options.body ?? null,
      mediaProvider: stored.provider,
      mediaKey: stored.key,
      mediaUrl: stored.url,
      mediaMimeType: mimeType,
      mediaSizeBytes: stored.sizeBytes,
      viewOnce: options.viewOnce,
    });
  }

  /**
   * Abre un mensaje de vista única: la única llamada cuya respuesta lleva la
   * URL real del archivo (ver `mapMessageToResponse`). El marcado es una
   * sola `UPDATE ... WHERE viewed_at IS NULL RETURNING` (ver
   * `tryMarkMessageViewed`) — no un `find` seguido de `update` — para que dos
   * aperturas concurrentes no puedan ganar las dos. También excluye a quien
   * lo mandó: el emisor no puede gastar su propio envío antes de que el
   * destinatario lo abra.
   */
  async viewMessage(conversationId: string, messageId: string, userId: string): Promise<MessageResponse> {
    await this.assertParticipant(conversationId, userId);
    const viewed = await this.repository.tryMarkMessageViewed(conversationId, messageId, userId);
    if (viewed) return mapMessageToResponse(viewed, { revealViewOnce: true });

    // No se pudo marcar: averiguar por qué, solo para dar el error correcto.
    const message = await this.repository.getMessage(conversationId, messageId);
    if (!message || !message.viewOnce) throw new NotFoundException("Mensaje no encontrado.");
    if (message.senderId === userId) {
      throw new ForbiddenException("No puedes abrir tu propio envío de vista única.");
    }
    throw new ConflictException("Este contenido ya no está disponible: se ve una sola vez.");
  }

  /** El apodo es privado: se aplica siempre a la propia fila de participante de quien llama. */
  async setNickname(
    conversationId: string,
    userId: string,
    nickname: string | null,
  ): Promise<{ updated: true }> {
    await this.assertParticipant(conversationId, userId);
    await this.repository.setNickname(conversationId, userId, nickname);
    return { updated: true };
  }

  async markDelivered(conversationId: string, userId: string): Promise<void> {
    await this.repository.markDelivered(conversationId, userId);
    this.chatEvents.emitDelivered(conversationId, { userId, deliveredAt: new Date().toISOString() });
  }

  async markRead(conversationId: string, userId: string): Promise<{ read: true }> {
    await this.assertParticipant(conversationId, userId);
    await this.repository.markRead(conversationId, userId);
    const now = new Date().toISOString();
    this.chatEvents.emitDelivered(conversationId, { userId, deliveredAt: now });
    this.chatEvents.emitRead(conversationId, { userId, readAt: now });
    return { read: true };
  }
}
