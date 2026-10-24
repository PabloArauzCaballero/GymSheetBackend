import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { env } from "../../config/env";
import { PushDispatcherService } from "../notifications/delivery/push-dispatcher.service";
import { NotificationService } from "../notifications/notification.service";
import { UsersRepository } from "../users/users.repository";
import { SocialService } from "../social/social.service";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatHistoryItem, mapConversationSummary, mapPendingReplies, mapDisappearingTimerEvent, mapMessageToResponse, mapTrainingInviteEvent, MessageResponse } from "./chat.mapper";
import { MessageCreateFields, ChatRepository } from "./chat.repository";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { SystemChatService } from "./system-chat.service";
import { ChatMediaCipher } from "./chat-media-cipher";
import { stripChatImageMetadata } from "./chat-image-metadata";
import { isChatStickerId } from "./chat-sticker-catalog";
import { validateChatAudio } from "./chat-audio-validation";

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
    // El despachador, no un transporte concreto: quien no tiene la app abierta
    // puede tener el navegador delante, y desde ADR-0011 ambos destinos suenan.
    private readonly push: PushDispatcherService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly mediaStorage: MediaStorageProvider,
    private readonly mediaCipher: ChatMediaCipher,
    @Optional() private readonly notificationPreferences?: NotificationService,
  ) {}

  private readonly logger = new Logger(ChatService.name);

  /**
   * El chat solo tiene sentido entre conexiones aceptadas. Las conexiones
   * cross-gym autorizadas siguen usando este mismo acceso; tenant nunca es una
   * frontera de privacidad para la conversación una vez que ambas personas
   * aceptaron.
   */
  async getOrStartConversation(
    userId: string,
    _tenantId: string,
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
    if (!other) {
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

  /** Matches que esperan respuesta mía: lo que lee el widget «Matches» de la app. */
  async pendingReplies(userId: string) {
    return mapPendingReplies(await this.repository.listPendingReplies(userId));
  }

  async listMessages(conversationId: string, userId: string, limit: number, before?: string, beforeId?: string): Promise<ChatHistoryItem[]> {
    await this.assertParticipant(conversationId, userId);
    const messages = await this.repository.listMessages(conversationId, userId, limit, before, beforeId);
    // Traer el historial es, como mínimo, haberlo recibido: adelanta el
    // cursor de entregado aunque el socket nunca haya estado conectado.
    await this.markDelivered(conversationId, userId);
    const extras = await this.repository.messageExtras(
      messages.flatMap((record) => (record.kind === "message" ? [record.message] : [])),
      userId,
    );
    return messages.map((record) => {
      if (record.kind === "system") return mapTrainingInviteEvent(record.event);
      if (record.kind === "timer") return mapDisappearingTimerEvent(record.event);
      return mapMessageToResponse(record.message, {
        storyAvailable: record.storyAvailable,
        extras: extras.get(record.message.id),
      });
    });
  }

  /** Único punto que realmente escribe un mensaje — cada `send*` público arma los campos y pasa por acá. */
  private async persistMessage(
    conversationId: string,
    senderId: string,
    fields: MessageCreateFields,
    clientRequestId?: string,
  ): Promise<MessageResponse> {
    const participant = await this.assertParticipant(conversationId, senderId);
    if (!participant.canWrite) {
      throw new ForbiddenException("Esta conversación es de solo lectura.");
    }
    const { message, created } = clientRequestId
      ? await this.repository.createMessageIdempotent(conversationId, senderId, clientRequestId, fields)
      : { message: await this.repository.createMessage(conversationId, senderId, fields), created: true };
    // Quien envía no puede citar algo que ocultó (lo valida la creación), así
    // que su vista de la cita sirve también para el evento de la sala.
    const extras = (await this.repository.messageExtras([message], senderId)).get(message.id);
    const response = mapMessageToResponse(message, { extras });
    if (created) {
      const published = await this.repository.publishMessageIfVisible(conversationId, message.id, () => {
        this.chatEvents.emitMessage(response);
      });
      if (published) await this.pushToAbsentRecipients(response, senderId);
    }
    return mapMessageToResponse(await this.repository.refreshMessageForResponse(message), { extras });
  }

  /**
   * Avisa al teléfono de quien no tenga un socket abierto.
   *
   * Hasta ahora el chat no avisaba de nada fuera de la app: emitía por socket y
   * nada más. El push del repo viajaba solo con las notificaciones in-app que
   * ya existían —recordatorios de membresía—, así que un mensaje a alguien con
   * la app cerrada no producía nada, que es justamente el caso por el que un
   * chat quiere push.
   *
   * Quien está conectado no lo recibe: el socket ya le entregó el mensaje y un
   * push encima sería un doble aviso. La presencia es del proceso, así que con
   * varias instancias de la API alguien conectado a otra instancia sí recibiría
   * push; es asumible con el despliegue de una sola instancia que hay hoy.
   *
   * `sendToUser` nunca lanza (es best-effort por diseño); el try/catch cubre la
   * consulta de participantes y la del remitente. El mensaje ya está escrito y
   * emitido: que el aviso falle no puede convertir un envío correcto en un 500.
   */
  private async pushToAbsentRecipients(message: MessageResponse, senderId: string): Promise<void> {
    try {
      const recipients = await this.repository.listOtherParticipants(message.conversationId, senderId);
      const absent = recipients.filter((participant) => !this.presence.isOnline(participant.userId));
      if (absent.length === 0) return;
      const sender = await this.usersRepository.findActiveById(senderId);
      const title = sender?.fullName ?? "Mensaje nuevo";
      const previews = await Promise.all(absent.map(async (participant) => ({
        userId: participant.userId,
        enabled: await this.notificationPreferences?.allowsMessagePreview(participant.userId) ?? false,
      })));
      const previewByUser = new Map(previews.map(({ userId, enabled }) => [userId, enabled]));
      let deliveries: Promise<PromiseSettledResult<unknown>[]> | undefined;
      // Resolve recipients/title before the lock, then re-check current markers.
      // Initiate dispatch synchronously under the lock, but await external I/O only after release.
      await this.repository.publishMessageIfVisible(message.conversationId, message.id, () => {
        deliveries = Promise.allSettled(absent.map((participant) =>
          this.push.sendToUser(participant.userId, {
            title,
            body: previewByUser.get(participant.userId)
              ? ChatService.previewFor(message)
              : "Tienes un mensaje nuevo.",
            url: `/chat/${message.conversationId}`,
          }),
        ));
      });
      if (deliveries) {
        const failed = (await deliveries).find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
    } catch (error: unknown) {
      this.logger.warn({
        event: "chat.push_notify_failed",
        conversationId: message.conversationId,
        messageId: message.id,
        reason: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  /** Qué se lee en la pantalla bloqueada. El contenido de un medio no se adelanta ahí. */
  private static previewFor(message: MessageResponse): string {
    if (message.type === "image") return message.viewOnce ? "Te envió una foto de vista única" : "Te envió una foto";
    if (message.type === "video") return message.viewOnce ? "Te envió un video de vista única" : "Te envió un video";
    if (message.type === "location") return message.locationLabel ? `Compartió un lugar: ${message.locationLabel}` : "Compartió su ubicación";
    if (message.type === "sticker") return "Te envió un sticker";
    const body = message.body?.trim() ?? "";
    if (body.length === 0) return "Te envió un mensaje";
    return body.length > 140 ? `${body.slice(0, 139)}…` : body;
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    body: string,
    clientRequestId?: string,
    replyToId?: string,
  ): Promise<MessageResponse> {
    return this.persistMessage(conversationId, senderId, { type: "text", body, ...(replyToId ? { replyToId } : {}) }, clientRequestId);
  }

  async sendStoryReply(
    conversationId: string,
    senderId: string,
    body: string,
    storyId: string,
    clientRequestId: string,
  ): Promise<MessageResponse> {
    return this.persistMessage(conversationId, senderId, { type: "text", body, storyId }, clientRequestId);
  }

  async sendStickerMessage(
    conversationId: string,
    senderId: string,
    stickerId: string,
    clientRequestId?: string,
    replyToId?: string,
  ): Promise<MessageResponse> {
    if (!isChatStickerId(stickerId)) throw new BadRequestException("Sticker de catálogo no válido.");
    return this.persistMessage(conversationId, senderId, { type: "sticker", body: stickerId, ...(replyToId ? { replyToId } : {}) }, clientRequestId);
  }

  async sendLocationMessage(
    conversationId: string,
    senderId: string,
    location: { lat: number; lng: number; label?: string },
    clientRequestId?: string,
    replyToId?: string,
  ): Promise<MessageResponse> {
    return this.persistMessage(conversationId, senderId, {
      type: "location",
      locationLat: location.lat,
      locationLng: location.lng,
      locationLabel: location.label ?? null,
      ...(replyToId ? { replyToId } : {}),
    }, clientRequestId);
  }

  /**
   * Mensajes temporales, como en WhatsApp: cualquiera de los dos lo cambia, el
   * aviso queda en el historial de ambos y lo que se envíe desde ahora caduca.
   * Lo ya enviado conserva la caducidad (o la falta de ella) con la que nació.
   */
  async setDisappearingMessages(
    conversationId: string,
    userId: string,
    seconds: number | null,
  ): Promise<{ conversationId: string; disappearingSeconds: number | null }> {
    const { event } = await this.repository.setDisappearingSeconds(conversationId, userId, seconds);
    if (event) this.chatEvents.emitSystemEvent(mapDisappearingTimerEvent(event));
    return { conversationId, disappearingSeconds: seconds };
  }

  async sendMediaMessage(
    conversationId: string,
    senderId: string,
    file: UploadedChatMedia | undefined,
    options: { type: "image" | "video" | "audio"; body?: string; viewOnce: boolean; replyToId?: string },
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
    // La nota de voz tiene su propio validador estructural (M4A AAC, ≤ 120 s):
    // la lista configurable gobierna fotos y videos. Un despliegue con la lista
    // vieja (sin `audio/mp4`) rechazaba todas las notas de voz.
    const allowed = options.type === "audio"
      ? mimeType === "audio/mp4"
      : env.CHAT_MEDIA_ALLOWED_MIME.includes(mimeType);
    if (!allowed) {
      throw new BadRequestException("Tipo de archivo no admitido.");
    }
    if (options.type === "audio") validateChatAudio(file.buffer, mimeType);
    else if (mimeType.startsWith("audio/")) throw new BadRequestException("El archivo de audio debe enviarse como audio.");
    // Verificado antes de subir: no tiene sentido pagar la subida a storage
    // para una conversación a la que el remitente no puede escribir.
    const participant = await this.assertParticipant(conversationId, senderId);
    if (!participant.canWrite) {
      throw new ForbiddenException("Esta conversación es de solo lectura.");
    }

    const plainBuffer = mimeType.startsWith("image/")
      ? await stripChatImageMetadata(file.buffer, mimeType)
      : file.buffer;
    if (plainBuffer.byteLength > env.CHAT_MEDIA_MAX_BYTES) {
      throw new BadRequestException(`El archivo excede el tamaño máximo de ${env.CHAT_MEDIA_MAX_BYTES} bytes.`);
    }
    const encryptedBuffer = this.mediaCipher.encrypt(plainBuffer);
    const stored = await this.mediaStorage.upload(
      {
        originalName: file.originalname,
        mimeType,
        sizeBytes: encryptedBuffer.byteLength,
        buffer: encryptedBuffer,
      },
      // La carpeta es del REMITENTE: quien sube es el dueño del binario, y así
      // un adjunto vive bajo el perfil de quien lo compartió aunque la
      // conversación tenga dos lados.
      { category: "chats", ownerUserId: senderId, conversationId },
    );

    return this.persistMessage(conversationId, senderId, {
      type: options.type,
      body: options.body ?? null,
      mediaProvider: stored.provider,
      mediaKey: stored.key,
      mediaUrl: stored.url,
      mediaMimeType: mimeType,
      mediaSizeBytes: stored.sizeBytes,
      viewOnce: options.viewOnce,
      ...(options.replyToId ? { replyToId: options.replyToId } : {}),
    });
  }

  /**
   * Reenviar, como WhatsApp: una copia nueva («Reenviado») en `targetConversationId`.
   * Un adjunto se copia como binario cifrado bajo la carpeta de quien reenvía,
   * sin descifrarlo ni compartir la clave de storage con el original: borrar o
   * purgar uno nunca deja al otro sin archivo. La vista única no se reenvía.
   */
  async forwardMessage(
    targetConversationId: string,
    userId: string,
    fromConversationId: string,
    messageId: string,
  ): Promise<MessageResponse> {
    await this.assertParticipant(fromConversationId, userId);
    const source = await this.repository.getMessage(fromConversationId, messageId, userId);
    if (!source) throw new NotFoundException("Mensaje no encontrado.");
    if (source.viewOnce) throw new BadRequestException("Los mensajes de vista única no se pueden reenviar.");
    const target = await this.assertParticipant(targetConversationId, userId);
    if (!target.canWrite) throw new ForbiddenException("Esta conversación es de solo lectura.");

    if (source.type === "image" || source.type === "video" || source.type === "audio") {
      if (!source.mediaKey || !source.mediaMimeType || source.mediaProvider !== this.mediaStorage.name) {
        throw new NotFoundException("Archivo no encontrado.");
      }
      let encrypted: Buffer;
      try {
        encrypted = await this.mediaStorage.download(source.mediaKey);
      } catch {
        throw new NotFoundException("Archivo no encontrado.");
      }
      const stored = await this.mediaStorage.upload(
        {
          originalName: `reenviado-${source.id}`,
          mimeType: source.mediaMimeType,
          sizeBytes: encrypted.byteLength,
          buffer: encrypted,
        },
        { category: "chats", ownerUserId: userId, conversationId: targetConversationId },
      );
      return this.persistMessage(targetConversationId, userId, {
        type: source.type,
        body: source.body,
        mediaProvider: stored.provider,
        mediaKey: stored.key,
        mediaUrl: stored.url,
        mediaMimeType: source.mediaMimeType,
        mediaSizeBytes: stored.sizeBytes,
        viewOnce: false,
        forwarded: true,
      });
    }
    if (source.type === "location") {
      return this.persistMessage(targetConversationId, userId, {
        type: "location",
        locationLat: source.locationLat,
        locationLng: source.locationLng,
        locationLabel: source.locationLabel ?? null,
        forwarded: true,
      });
    }
    return this.persistMessage(targetConversationId, userId, { type: source.type, body: source.body, forwarded: true });
  }

  async downloadMedia(
    conversationId: string,
    messageId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    await this.assertParticipant(conversationId, userId);
    const message = await this.repository.getMessage(conversationId, messageId, userId);
    if (!message?.mediaKey || !message.mediaMimeType) throw new NotFoundException("Archivo no encontrado.");
    if (message.mediaProvider !== this.mediaStorage.name) throw new NotFoundException("Archivo no encontrado.");
    if (message.viewOnce && message.senderId === userId) {
      throw new ForbiddenException("No puedes abrir tu propio envío de vista única.");
    }
    if (message.viewOnce && !message.viewedAt) {
      throw new ForbiddenException("Abre el mensaje de vista única antes de descargar el archivo.");
    }

    try {
      const encrypted = await this.mediaStorage.download(message.mediaKey);
      // La descarga puede esperar I/O remoto: una revocación ocurrida durante
      // esa espera debe bloquear también la respuesta que ya estaba en curso.
      await this.assertParticipant(conversationId, userId);
      if (!await this.repository.getMessage(conversationId, messageId, userId)) throw new NotFoundException("Archivo no encontrado.");
      return { buffer: this.mediaCipher.decrypt(encrypted), mimeType: message.mediaMimeType };
    } catch {
      // Nunca devolver al cliente el storage key, la ruta local o el error del proveedor.
      throw new NotFoundException("Archivo no encontrado.");
    }
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
    if (viewed) {
      // The marking transaction has committed. Refresh under the conversation
      // lock so a global delete or local hide that committed while the caller
      // was waiting cannot leak the stale caption or media URL.
      const current = await this.repository.refreshViewedMessageForResponse(conversationId, messageId, userId);
      const extras = (await this.repository.messageExtras([current], userId)).get(current.id);
      return mapMessageToResponse(current, { revealViewOnce: true, extras });
    }

    // No se pudo marcar: averiguar por qué, solo para dar el error correcto.
    const message = await this.repository.getMessage(conversationId, messageId, userId);
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
    await this.repository.withActiveConversationAndReadReceiptLock(conversationId, async (transaction, participantIds) => {
      if (!participantIds.includes(userId)) throw new NotFoundException("Conversación no encontrada.");
      const receiptPolicy = await this.repository.readReceiptPolicy(conversationId, transaction);
      await this.repository.markRead(conversationId, userId, receiptPolicy.allowed, transaction);
      const now = new Date().toISOString();
      this.chatEvents.emitDelivered(conversationId, { userId, deliveredAt: now });
      if (receiptPolicy.allowed) {
        // Keep publication under the same user-row lock as settings updates so
        // a stale `allowed: true` read cannot be emitted after the opt-out event.
        this.chatEvents.emitRead(conversationId, { userId, readAt: now, readFrom: receiptPolicy.enabledSince });
      }
    });
    return { read: true };
  }
}
