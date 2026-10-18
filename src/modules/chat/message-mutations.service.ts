import { chatRequestFingerprint } from "./chat-request-fingerprint";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ChatRepository } from "./chat.repository";
import { ChatEventsService } from "./chat-events.service";
import { mapMessageToResponse, MessageReaction } from "./chat.mapper";
import { DeleteMessageInput, deleteMessageSchema, EditMessageInput, editMessageSchema, setReactionSchema } from "./chat.schemas";
import { MessageReactionModel } from "./message-reaction.model";
import { ConversationModel } from "./conversation.model";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { MessageVisibilityModel } from "./message-visibility.model";
import { MessageModel } from "./message.model";
import { isExpired } from "./chat-disappearing";

/** Como WhatsApp: «Eliminar para todos» dura unos dos días (60 h); editar, 15 minutos. */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 60 * 1000;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class MessageMutationsService {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ConversationModel) private readonly conversations: typeof ConversationModel,
    @InjectModel(ConversationParticipantModel) private readonly participants: typeof ConversationParticipantModel,
    @InjectModel(MessageModel) private readonly messages: typeof MessageModel,
    private readonly events: ChatEventsService,
    @InjectModel(MessageVisibilityModel) private readonly visibility: typeof MessageVisibilityModel,
    private readonly repository: ChatRepository,
    @InjectModel(MessageReactionModel) private readonly reactions: typeof MessageReactionModel,
  ) {}

  async deleteMessage(conversationId: string, messageId: string, userId: string, input: DeleteMessageInput) {
    if (!deleteMessageSchema.safeParse(input).success) throw new BadRequestException("El alcance de eliminación no es válido.");
    const result = await this.sequelize.transaction(async (transaction) => {
      // Serialize the access decision with block/disconnect and concurrent retries.
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const participant = await this.participants.findOne({ where: { conversationId, userId }, transaction });
      if (!participant) throw new NotFoundException("Conversación no encontrada.");
      const message = await this.messages.findOne({ where: { id: messageId, conversationId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!message || isExpired(message)) throw new NotFoundException("Mensaje no encontrado.");
      if (input.scope === "EVERYONE") {
        if (message.senderId !== userId) throw new NotFoundException("Mensaje no encontrado.");
        if (message.deletedAt) return { message, changed: false };
        const now = new Date(Date.now());
        const age = now.getTime() - message.createdAt.getTime();
        if (age < 0 || age > DELETE_FOR_EVERYONE_WINDOW_MS) throw new BadRequestException("El plazo para eliminar este mensaje terminó.");
        const recoverable = message.idempotencyBody !== null || message.editedAt === null;
        const deletedRequestHash = message.clientRequestId && recoverable ? chatRequestFingerprint({
          type: message.type, body: message.idempotencyBody ?? message.body,
          locationLat: message.locationLat, locationLng: message.locationLng, storyId: message.storyId,
        }) : null;
        await message.update({ deletedAt: now, deletedRequestHash, body: null, idempotencyBody: null,
          type: "text", editedAt: null, mediaProvider: null, mediaKey: null, mediaUrl: null,
          mediaMimeType: null, mediaSizeBytes: null, locationLat: null, locationLng: null,
          viewOnce: false, viewedAt: null, storyId: null, replyToId: null, forwarded: false,
        }, { transaction });
        // Un mensaje eliminado para todos no conserva ni sus reacciones ni su cita.
        await this.reactions.destroy({ where: { messageId }, transaction });
        return { message, changed: true };
      }
      // Local hiding is available to recipients and read-only participants, with no deadline.
      await this.visibility.findOrCreate({ where: { messageId, userId }, transaction });
    });
    if (result) {
      if (result.changed) await this.repository.publishDeletion(conversationId, messageId, () => {
        this.events.emitMessageDeleted({ conversationId, messageId, scope: "EVERYONE", deletedAt: result.message.deletedAt! });
      });
      return { ...mapMessageToResponse(result.message), scope: "EVERYONE" as const };
    }
    return { messageId, scope: "ME" as const };
  }

  async editMessage(conversationId: string, messageId: string, userId: string, input: EditMessageInput) {
    const validated = editMessageSchema.safeParse(input);
    if (!validated.success) throw new BadRequestException("El texto del mensaje no es válido.");
    const edited = await this.sequelize.transaction(async (transaction) => {
      // The same lock used by send/block/disconnect serializes authorization with revocation.
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const participant = await this.participants.findOne({ where: { conversationId, userId }, transaction });
      if (!participant) throw new NotFoundException("Conversación no encontrada.");
      const message = await this.messages.findOne({
        where: { id: messageId, conversationId, senderId: userId }, transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!message || message.deletedAt || isExpired(message) || await this.visibility.findOne({ where: { messageId, userId }, transaction })) {
        throw new NotFoundException("Mensaje no encontrado.");
      }
      if (!participant.canWrite) throw new ForbiddenException("Esta conversación es de solo lectura.");
      if (message.type !== "text") throw new BadRequestException("Solo puedes editar mensajes de texto.");
      // Sample server time after acquiring locks: waiting for a lock cannot extend the deadline.
      const now = new Date(Date.now());
      const age = now.getTime() - message.createdAt.getTime();
      if (age < 0 || age > EDIT_WINDOW_MS) throw new BadRequestException("El plazo para editar este mensaje terminó.");
      await message.update({ body: validated.data.body, editedAt: now }, { transaction });
      return message;
    });
    // The same guard protects initial messages, edits and push initiation.
    const extras = (await this.repository.messageExtras([edited], userId)).get(edited.id);
    await this.repository.publishMessageIfVisible(conversationId, messageId, () => {
      this.events.emitMessageUpdated(mapMessageToResponse(edited, { extras }));
    });
    return mapMessageToResponse(await this.repository.refreshMessageForResponse(edited), { extras });
  }

  /**
   * Reaccionar como en WhatsApp: una reacción por persona y mensaje; otra la
   * reemplaza y `null` la quita. Solo sobre algo que quien reacciona todavía
   * ve, y solo si puede escribir en la conversación. Se emite el estado
   * completo de las reacciones del mensaje para que el cliente lo reemplace.
   */
  async setReaction(conversationId: string, messageId: string, userId: string, emoji: string | null) {
    if (!setReactionSchema.safeParse({ emoji }).success) throw new BadRequestException("La reacción debe ser un emoji.");
    const reactions = await this.sequelize.transaction(async (transaction): Promise<MessageReaction[]> => {
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const participant = await this.participants.findOne({ where: { conversationId, userId }, transaction });
      if (!participant) throw new NotFoundException("Conversación no encontrada.");
      const message = await this.messages.findOne({
        where: { id: messageId, conversationId, deletedAt: null, [Op.and]: this.repository.visibleTo(userId) },
        transaction,
      });
      if (!message) throw new NotFoundException("Mensaje no encontrado.");
      if (!participant.canWrite) throw new ForbiddenException("Esta conversación es de solo lectura.");
      if (emoji === null) {
        await this.reactions.destroy({ where: { messageId, userId }, transaction });
      } else {
        await this.reactions.upsert({ messageId, userId, emoji }, { transaction });
      }
      return this.repository.listReactions(messageId, transaction);
    });
    const payload = { conversationId, messageId, reactions };
    await this.repository.publishIfMessageAlive(conversationId, messageId, () => {
      this.events.emitMessageReaction(payload);
    });
    return payload;
  }
}
