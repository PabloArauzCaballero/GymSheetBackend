import { chatRequestFingerprint } from "./chat-request-fingerprint";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { literal, Op, QueryTypes, Transaction, type WhereOptions } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { ConversationModel } from "./conversation.model";
import { MessageVisibilityModel } from "./message-visibility.model";
import { lockSocialPairUsers } from "../social/social-pair-lock";
import { MessageModel, MessageType } from "./message.model";
import { expiryFor } from "./chat-disappearing";
import { MessageReactionModel } from "./message-reaction.model";
import { replyPreviewOf, type MessageExtras, type MessageReaction } from "./chat.mapper";

export const REPLY_UNAVAILABLE_MESSAGE = "El mensaje al que respondes ya no está disponible.";

export type SystemConversationKind = "CORPORATE" | "TENANT_ADMIN";

export type MessageCreateFields = {
  type: MessageType;
  body?: string | null;
  mediaProvider?: string | null;
  mediaKey?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  viewOnce?: boolean;
  locationLat?: number | null;
  locationLng?: number | null;
  locationLabel?: string | null;
  storyId?: string | null;
  /** Mensaje citado; se valida dentro de la misma transacción que crea la respuesta. */
  replyToId?: string | null;
  forwarded?: boolean;
};

export interface ConversationSummaryRow {
  conversation_id: string;
  other_user_id: string;
  other_user_name: string;
  other_user_photo_url: string | null;
  other_user_last_seen_at: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  can_write: boolean;
  system_kind: SystemConversationKind | null;
  /** Apodo que YO le puse a esta conversación, o `null` si no le puse ninguno. */
  nickname: string | null;
  /** Cursores del OTRO participante — con qué comparar el `createdAt` de mis propios mensajes para pintar el check. */
  other_last_delivered_at: string | null;
  other_last_read_at: string | null;
  other_read_receipts_enabled_since: string | Date | null;
  /** Mensajes temporales vigentes en la conversación; `null` = desactivados. */
  disappearing_seconds: number | null;
}

/** Un match que espera respuesta mía (ver `listPendingReplies`). */
export interface PendingReplyRow {
  other_user_id: string;
  other_user_name: string;
  conversation_id: string | null;
  waiting_since: Date | string;
}

/** Pasado este plazo, un match en silencio deja de contar como pendiente. */
export const PENDING_REPLY_WINDOW_DAYS = 14;

export interface MessageWithStoryAvailability {
  readonly message: MessageModel;
  readonly storyAvailable?: boolean;
}

export interface TrainingInviteConversationEvent {
  readonly id: string;
  readonly conversationId: string;
  readonly invitationId: string;
  readonly acceptedRevision: number;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly placeLabel: string;
  readonly cancelledAt?: Date | null;
  readonly createdAt: Date;
}

/** Aviso de sistema «X activó/desactivó los mensajes temporales». */
export interface DisappearingTimerEvent {
  readonly id: string;
  readonly conversationId: string;
  readonly changedByUserId: string | null;
  readonly seconds: number | null;
  readonly createdAt: Date;
}

export type ConversationHistoryRecord =
  | { readonly kind: "message"; readonly message: MessageModel; readonly storyAvailable?: boolean }
  | { readonly kind: "system"; readonly event: TrainingInviteConversationEvent }
  | { readonly kind: "timer"; readonly event: DisappearingTimerEvent };

@Injectable()
export class ChatRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ConversationModel)
    private readonly conversations: typeof ConversationModel,
    @InjectModel(ConversationParticipantModel)
    private readonly participants: typeof ConversationParticipantModel,
    @InjectModel(MessageModel)
    private readonly messages: typeof MessageModel,
    @InjectModel(MessageVisibilityModel)
    private readonly visibility: typeof MessageVisibilityModel = MessageVisibilityModel,
    @InjectModel(MessageReactionModel)
    private readonly reactions: typeof MessageReactionModel = MessageReactionModel,
  ) {}

  /**
   * Cita y reacciones de una tanda de mensajes, en tres consultas fijas (sin
   * N+1). `viewerId` decide si una cita a un mensaje que esa persona ocultó se
   * muestra como «no disponible»; `null` = vista compartida (eventos de sala).
   */
  async messageExtras(
    messages: ReadonlyArray<Pick<MessageModel, "id" | "conversationId" | "replyToId">>,
    viewerId: string | null,
    transaction?: Transaction,
  ): Promise<Map<string, MessageExtras>> {
    const extras = new Map<string, MessageExtras>();
    if (messages.length === 0) return extras;
    const ids = messages.map((message) => message.id);
    const replyIds = [...new Set(messages.map((message) => message.replyToId).filter((id): id is string => Boolean(id)))];
    const [targets, hidden, reactionRows] = await Promise.all([
      replyIds.length ? this.messages.findAll({ where: { id: replyIds }, transaction }) : Promise.resolve([]),
      replyIds.length && viewerId
        ? this.visibility.findAll({ where: { userId: viewerId, messageId: replyIds }, transaction })
        : Promise.resolve([]),
      this.reactions.findAll({ where: { messageId: ids }, order: [["createdAt", "ASC"], ["userId", "ASC"]], transaction }),
    ]);
    const targetById = new Map(targets.map((target) => [target.id, target]));
    const hiddenIds = new Set(hidden.map((row) => row.messageId));
    const reactionsById = new Map<string, MessageReaction[]>();
    for (const row of reactionRows) {
      const list = reactionsById.get(row.messageId) ?? [];
      list.push({ userId: row.userId, emoji: row.emoji });
      reactionsById.set(row.messageId, list);
    }
    const now = new Date();
    for (const message of messages) {
      const target = message.replyToId ? targetById.get(message.replyToId) : undefined;
      const sameConversation = target && target.conversationId === message.conversationId ? target : undefined;
      extras.set(message.id, {
        replyTo: replyPreviewOf(sameConversation, Boolean(message.replyToId && hiddenIds.has(message.replyToId)), now),
        reactions: reactionsById.get(message.id) ?? [],
      });
    }
    return extras;
  }

  /** Las reacciones vigentes de un mensaje, en el orden en que llegaron. */
  async listReactions(messageId: string, transaction?: Transaction): Promise<MessageReaction[]> {
    const rows = await this.reactions.findAll({
      where: { messageId }, order: [["createdAt", "ASC"], ["userId", "ASC"]], transaction,
    });
    return rows.map((row) => ({ userId: row.userId, emoji: row.emoji }));
  }

  /** Solo se responde a algo de esta misma conversación que el remitente todavía ve. */
  private async assertReplyTarget(
    conversationId: string,
    senderId: string,
    replyToId: string | null | undefined,
    transaction: Transaction,
  ): Promise<void> {
    if (!replyToId) return;
    const target = await this.messages.findOne({
      where: { id: replyToId, conversationId, deletedAt: null, [Op.and]: this.visibleTo(senderId) },
      transaction,
    });
    if (!target) throw new BadRequestException(REPLY_UNAVAILABLE_MESSAGE);
  }

  /** Publica un evento que solo lleva identificadores mientras el mensaje siga vivo y la conversación activa. */
  async publishIfMessageAlive(conversationId: string, messageId: string, publish: () => void): Promise<boolean> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) return false;
      const message = await this.messages.findOne({ where: { id: messageId, conversationId }, transaction });
      if (!message || message.deletedAt) return false;
      publish();
      return true;
    });
  }

  /** Run only a synchronous publication/initiation while hiding and revocation cannot commit. */
  async publishMessageIfVisible(conversationId: string, messageId: string, publish: () => void): Promise<boolean> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) return false;
      const message = await this.messages.findOne({ where: { id: messageId, conversationId }, transaction });
      if (!message || message.deletedAt) return false;
      if (await this.visibility.findOne({ where: { messageId }, transaction })) return false;
      publish();
      return true;
    });
  }

  /** Final response snapshot serialized with deletion, local hiding and access revocation. */
  async refreshMessageForResponse(message: MessageModel): Promise<MessageModel> {
    return this.sequelize.transaction(async transaction => {
      const conversation = await this.conversations.findByPk(message.conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const current = await this.messages.findOne({ where: { id: message.id, conversationId: message.conversationId, senderId: message.senderId }, transaction });
      if (!current || await this.visibility.findOne({ where: { messageId: message.id, userId: message.senderId }, transaction })) {
        throw new NotFoundException("Mensaje no encontrado.");
      }
      return current;
    });
  }

  /** Refresh a consumed view-once message for its viewer after the marking transaction commits. */
  async refreshViewedMessageForResponse(
    conversationId: string,
    messageId: string,
    viewerId: string,
  ): Promise<MessageModel> {
    return this.sequelize.transaction(async transaction => {
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const current = await this.messages.findOne({
        where: {
          id: messageId,
          conversationId,
          viewOnce: true,
          viewedAt: { [Op.not]: null },
          deletedAt: null,
          senderId: { [Op.ne]: viewerId },
          [Op.and]: this.visibleTo(viewerId),
        },
        transaction,
      });
      if (!current) throw new NotFoundException("Mensaje no encontrado.");
      return current;
    });
  }

  /** Tombstone notifications contain identifiers only and must reach locally hidden participants too. */
  async publishDeletion(conversationId: string, messageId: string, publish: () => void): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) return;
      const message = await this.messages.findOne({ where: { id: messageId, conversationId }, transaction });
      if (message?.deletedAt) publish();
    });
  }

  /**
   * La conversación 1:1 entre estos dos usuarios, si ya existe.
   *
   * "Exactamente estos dos" no tiene una forma limpia de expresarse como
   * `WHERE`, así que se cuenta: una conversación donde ambos participan y no
   * hay una tercera fila en `participants` es, por definición, la de los dos.
   */
  async findDirectConversation(userA: string, userB: string): Promise<string | null> {
    const rows = await this.sequelize.query<{ conversation_id: string }>(
      `SELECT p1.conversation_id
         FROM chat.participants p1
         JOIN chat.participants p2 ON p2.conversation_id = p1.conversation_id
         JOIN chat.conversations c ON c.id = p1.conversation_id AND c.revoked_at IS NULL
        WHERE p1.user_id = :userA AND p2.user_id = :userB
          AND (SELECT COUNT(*) FROM chat.participants p3 WHERE p3.conversation_id = p1.conversation_id) = 2
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userA, userB } },
    );
    return rows[0]?.conversation_id ?? null;
  }

  async createDirectConversation(userA: string, userB: string): Promise<string> {
    return this.sequelize.transaction(async (transaction) => {
      // Match block/revoke lock order so creation cannot slip between a block's
      // conversation scan and connection deletion.
      await lockSocialPairUsers(this.sequelize, userA, userB, transaction);
      const connection = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM social.connections
          WHERE status = 'ACCEPTED'
            AND ((requester_id = :userA AND addressee_id = :userB)
              OR (requester_id = :userB AND addressee_id = :userA))
            AND NOT EXISTS (
              SELECT 1 FROM social.user_blocks
               WHERE (blocker_id = :userA AND blocked_id = :userB)
                  OR (blocker_id = :userB AND blocked_id = :userA)
            )
          FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { userA, userB }, transaction },
      );
      if (!connection.length) throw new ForbiddenException("Solo puedes chatear con conexiones aceptadas.");
      const conversation = await this.conversations.create({}, { transaction });
      await this.participants.bulkCreate(
        [
          { conversationId: conversation.id, userId: userA, joinedAt: new Date() },
          { conversationId: conversation.id, userId: userB, joinedAt: new Date() },
        ],
        { transaction },
      );
      return conversation.id;
    });
  }

  /** Find/create a direct conversation inside a caller-owned transaction. */
  async ensureDirectConversationInTransaction(
    userA: string,
    userB: string,
    transaction: Transaction,
  ): Promise<string> {
    await lockSocialPairUsers(this.sequelize, userA, userB, transaction);
    const connection = await this.sequelize.query<{ id: string }>(
      `SELECT id FROM social.connections
        WHERE status = 'ACCEPTED'
          AND ((requester_id = :userA AND addressee_id = :userB)
            OR (requester_id = :userB AND addressee_id = :userA))
          AND NOT EXISTS (
            SELECT 1 FROM social.user_blocks
             WHERE (blocker_id = :userA AND blocked_id = :userB)
                OR (blocker_id = :userB AND blocked_id = :userA)
          )
        FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { userA, userB }, transaction },
    );
    if (!connection.length) throw new ForbiddenException("Solo puedes chatear con conexiones aceptadas.");

    const existing = await this.sequelize.query<{ conversation_id: string }>(
      `SELECT p1.conversation_id
         FROM chat.participants p1
         JOIN chat.participants p2 ON p2.conversation_id = p1.conversation_id
         JOIN chat.conversations c ON c.id = p1.conversation_id
          AND c.revoked_at IS NULL AND c.system_kind IS NULL
        WHERE p1.user_id = :userA AND p2.user_id = :userB
          AND (SELECT COUNT(*) FROM chat.participants p3 WHERE p3.conversation_id = p1.conversation_id) = 2
        ORDER BY c.created_at DESC
        LIMIT 1 FOR UPDATE OF c`,
      { type: QueryTypes.SELECT, replacements: { userA, userB }, transaction },
    );
    if (existing[0]) return existing[0].conversation_id;

    const conversation = await this.conversations.create({}, { transaction });
    const joinedAt = new Date();
    await this.participants.bulkCreate(
      [
        { conversationId: conversation.id, userId: userA, joinedAt },
        { conversationId: conversation.id, userId: userB, joinedAt },
      ],
      { transaction },
    );
    return conversation.id;
  }

  /**
   * Como `createDirectConversation`, pero para un chat de sistema fijo: el
   * lado regular queda sin permiso de escritura y la conversación se etiqueta
   * para fijarla arriba de la lista. `createDirectConversation` (chat normal
   * entre socios) no cambia — este es un camino aparte, no un caso especial
   * dentro de él.
   */
  async createSystemConversation(
    regularUserId: string,
    systemUserId: string,
    systemKind: SystemConversationKind,
  ): Promise<string> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.create(
        { systemKind },
        { transaction },
      );
      await this.participants.bulkCreate(
        [
          { conversationId: conversation.id, userId: regularUserId, joinedAt: new Date(), canWrite: false },
          { conversationId: conversation.id, userId: systemUserId, joinedAt: new Date(), canWrite: true },
        ],
        { transaction },
      );
      return conversation.id;
    });
  }

  isParticipant(conversationId: string, userId: string, transaction?: Transaction): Promise<boolean> {
    return this.sequelize.query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM chat.participants p
         JOIN chat.conversations c ON c.id = p.conversation_id AND c.revoked_at IS NULL
        WHERE p.conversation_id = :conversationId AND p.user_id = :userId
       ) AS found`,
      { type: QueryTypes.SELECT, replacements: { conversationId, userId }, ...(transaction ? { transaction } : {}) },
    ).then((rows) => rows[0]?.found === true);
  }

  async getParticipant(conversationId: string, userId: string): Promise<ConversationParticipantModel | null> {
    const rows = await this.sequelize.query<ConversationParticipantModel>(
      `SELECT p.conversation_id AS "conversationId", p.user_id AS "userId",
              p.can_write AS "canWrite", p.nickname, p.joined_at AS "joinedAt"
         FROM chat.participants p
         JOIN chat.conversations c ON c.id = p.conversation_id AND c.revoked_at IS NULL
        WHERE p.conversation_id = :conversationId AND p.user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { conversationId, userId } },
    );
    return rows[0] ?? null;
  }

  /** Los destinatarios de un mensaje: todos los de la conversación menos quien escribe. */
  listOtherParticipants(
    conversationId: string,
    senderId: string,
  ): Promise<ConversationParticipantModel[]> {
    return this.participants.findAll({
      where: { conversationId, userId: { [Op.ne]: senderId } },
    });
  }

  /** `null` borra el apodo; se aplica siempre a la fila del propio llamante. */
  async setNickname(conversationId: string, userId: string, nickname: string | null): Promise<void> {
    await this.participants.update({ nickname }, { where: { conversationId, userId } });
  }

  /**
   * Adelanta el cursor de "hasta cuándo recibí" de este participante. Nunca
   * lo retrocede: dos llamadas concurrentes (fetch REST + join de socket)
   * no deben pisarse una a la otra con una marca más vieja.
   */
  async markDelivered(conversationId: string, userId: string): Promise<void> {
    const now = new Date();
    await this.participants.update(
      { lastDeliveredAt: now },
      {
        where: {
          conversationId,
          userId,
          [Op.or]: [{ lastDeliveredAt: null }, { lastDeliveredAt: { [Op.lt]: now } }],
        },
      },
    );
  }

  async withActiveConversationLock<T>(
    conversationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.sequelize.transaction(async (transaction) => {
      const conversations = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM chat.conversations
          WHERE id = :conversationId AND revoked_at IS NULL
          FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { conversationId }, transaction },
      );
      if (!conversations.length) throw new NotFoundException("Conversación no encontrada.");
      return operation(transaction);
    });
  }

  /** Lock receipt participants first, then the conversation, matching social revocation order. */
  async withActiveConversationAndReadReceiptLock<T>(
    conversationId: string,
    operation: (transaction: Transaction, participantIds: string[]) => Promise<T>,
  ): Promise<T> {
    return this.sequelize.transaction(async (transaction) => {
      const participantIds = await this.lockReadReceiptParticipants(conversationId, transaction);
      const conversations = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM chat.conversations
          WHERE id = :conversationId AND revoked_at IS NULL
          FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { conversationId }, transaction },
      );
      if (!conversations.length) throw new NotFoundException("Conversación no encontrada.");
      return operation(transaction, participantIds);
    });
  }

  /** Lock every user contributing to BOOL_AND, in stable order, like settings updates do. */
  async lockReadReceiptParticipants(conversationId: string, transaction: Transaction): Promise<string[]> {
      const participants = await this.sequelize.query<{ user_id: string }>(
        `SELECT user_id FROM chat.participants WHERE conversation_id = :conversationId ORDER BY user_id`,
        { type: QueryTypes.SELECT, replacements: { conversationId }, transaction },
      );
      if (!participants.length) throw new NotFoundException("Conversación no encontrada.");
      const userIds: string[] = [];
      for (const { user_id: userId } of participants) {
        const users = await this.sequelize.query<{ id: string }>(
          `SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE`,
          { type: QueryTypes.SELECT, replacements: { userId }, transaction },
        );
        if (!users.length) throw new NotFoundException("Usuario no encontrado.");
        userIds.push(userId);
      }
      return userIds;
  }

  async markRead(
    conversationId: string,
    userId: string,
    publishReceipt: boolean,
    transaction?: Transaction,
  ): Promise<void> {
    const now = new Date();
    await this.participants.update(
      {
        lastReadAt: now,
        lastDeliveredAt: now,
        ...(publishReceipt ? { lastReceiptReadAt: now } : {}),
      },
      { where: { conversationId, userId }, ...(transaction ? { transaction } : {}) },
    );
  }

  /** Public read receipts require both sides to allow them for this conversation. */
  async readReceiptPolicy(
    conversationId: string,
    transaction?: Transaction,
  ): Promise<{ allowed: boolean; enabledSince: string | null }> {
    const rows = await this.sequelize.query<{ allowed: boolean; enabled_since: string | Date | null }>(
      `SELECT COALESCE(BOOL_AND(COALESCE(p.read_receipts_enabled, s.enabled, true)), false) AS allowed,
              MAX(CASE
                WHEN p.read_receipts_enabled IS NOT NULL THEN
                  CASE WHEN p.read_receipts_enabled THEN p.read_receipts_enabled_since ELSE NULL END
                ELSE CASE WHEN COALESCE(s.enabled, true) THEN s.enabled_since ELSE NULL END
              END) AS enabled_since
         FROM chat.participants p
         LEFT JOIN chat.read_receipt_settings s ON s.user_id = p.user_id
        WHERE p.conversation_id = :conversationId`,
      { type: QueryTypes.SELECT, replacements: { conversationId }, ...(transaction ? { transaction } : {}) },
    );
    const enabledSince = rows[0]?.enabled_since ?? null;
    return {
      allowed: rows[0]?.allowed === true,
      enabledSince: enabledSince instanceof Date ? enabledSince.toISOString() : enabledSince,
    };
  }

  createMessage(conversationId: string, senderId: string, fields: MessageCreateFields): Promise<MessageModel> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const participant = await this.participants.findOne({
        where: { conversationId, userId: senderId },
        transaction,
      });
      if (!participant) throw new NotFoundException("Conversación no encontrada.");
      if (!participant.canWrite) throw new ForbiddenException("Esta conversación es de solo lectura.");
      // El modo temporal se lee bajo el mismo bloqueo que lo cambia: un mensaje
      // enviado justo después de activarlo ya nace con caducidad.
      await this.assertReplyTarget(conversationId, senderId, fields.replyToId, transaction);
      const expiresAt = expiryFor(conversation.disappearingSeconds, new Date());
      return this.messages.create({ conversationId, senderId, ...fields, expiresAt }, { transaction });
    });
  }

  /** Conversation row lock serializes retries with sends and revocation. The unique index remains the DB invariant. */
  createMessageIdempotent(
    conversationId: string,
    senderId: string,
    clientRequestId: string,
    fields: MessageCreateFields,
  ): Promise<{ message: MessageModel; created: boolean }> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const participant = await this.participants.findOne({
        where: { conversationId, userId: senderId },
        transaction,
      });
      if (!participant) throw new NotFoundException("Conversación no encontrada.");
      if (!participant.canWrite) throw new ForbiddenException("Esta conversación es de solo lectura.");

      const existing = await this.messages.findOne({
        where: { conversationId, senderId, clientRequestId }, transaction,
      });
      if (existing) {
        if (await this.visibility.findOne({ where: { messageId: existing.id, userId: senderId }, transaction })) {
          throw new NotFoundException("Mensaje no encontrado.");
        }
        // Old writers may omit the snapshot during a rolling deploy. Only an
        // unedited body can safely stand in for the original request body.
        if (existing.deletedAt) {
          if (!existing.deletedRequestHash || existing.deletedRequestHash !== chatRequestFingerprint(fields)) {
            throw new ConflictException("El clientRequestId ya se usó para otro mensaje.");
          }
          return { message: existing, created: false };
        }
        const missingSnapshot = existing.idempotencyBody === null;
        if (missingSnapshot && existing.editedAt !== null) {
          throw new ConflictException("El clientRequestId ya se usó para otro mensaje.");
        }
        const originalBody = missingSnapshot ? existing.body : existing.idempotencyBody;
        const samePayload = existing.type === fields.type
          && originalBody === (fields.body ?? null)
          && existing.locationLat === (fields.locationLat ?? null)
          && existing.locationLng === (fields.locationLng ?? null)
          && existing.storyId === (fields.storyId ?? null)
          && (existing.replyToId ?? null) === (fields.replyToId ?? null);
        if (!samePayload) throw new ConflictException("El clientRequestId ya se usó para otro mensaje.");
        return { message: existing, created: false };
      }
      await this.assertReplyTarget(conversationId, senderId, fields.replyToId, transaction);
      const message = await this.messages.create({
        conversationId, senderId, clientRequestId, ...fields, idempotencyBody: fields.body ?? null,
        expiresAt: expiryFor(conversation.disappearingSeconds, new Date()),
      }, { transaction });
      return { message, created: true };
    });
  }

  getMessage(conversationId: string, messageId: string, userId: string): Promise<MessageModel | null> {
    return this.messages.findOne({
      where: { id: messageId, conversationId, deletedAt: null, [Op.and]: this.visibleTo(userId) },
      include: [{ model: ConversationModel, where: { revokedAt: null }, required: true }],
    });
  }

  /**
   * Marca visto de forma atómica: una sola `UPDATE ... WHERE viewed_at IS
   * NULL RETURNING`, no un `findOne` seguido de `update`. Dos aperturas
   * concurrentes de la misma vista única no deben poder ganar las dos — solo
   * una fila afectada gana, la otra recibe `null` y el llamador la trata como
   * "ya vista". También excluye a quien la mandó: el emisor no puede
   * "gastar" su propio envío antes de que el destinatario lo abra.
   */
  async tryMarkMessageViewed(
    conversationId: string,
    messageId: string,
    viewerId: string,
  ): Promise<MessageModel | null> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!conversation || conversation.revokedAt) return null;
      const [, affectedRows] = await this.messages.update(
        { viewedAt: new Date() },
        {
          where: {
            id: messageId,
            conversationId,
            viewOnce: true,
            viewedAt: null,
            deletedAt: null,
            senderId: { [Op.ne]: viewerId },
            [Op.and]: this.visibleTo(viewerId),
          },
          returning: true,
          transaction,
        },
      );
      return affectedRows[0] ?? null;
    });
  }

  /**
   * SQL predicate applied before LIMIT; values are escaped by Sequelize.
   * A disappearing message stops existing for everyone at `expires_at`, before
   * the purge removes the row.
   */
  visibleTo(userId: string): WhereOptions<MessageModel> {
    return {
      id: { [Op.notIn]: literal(`(
        SELECT message_id FROM chat.message_visibility WHERE user_id = ${this.sequelize.escape(userId)}
      )`) },
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: literal("now()") } }],
    };
  }

  async listMessages(
    conversationId: string,
    userId: string | number,
    requestedLimit?: number,
    before?: string,
    beforeId?: string,
  ): Promise<ConversationHistoryRecord[]> {
    const legacyCall = typeof userId === "number";
    const viewerId = legacyCall ? "" : userId;
    const limit = legacyCall ? userId : (requestedLimit ?? 20);
    const rows = await this.messages.findAll({
      where: {
        conversationId,
        ...(legacyCall ? {} : { [Op.and]: this.visibleTo(viewerId) }),
        ...(before ? { [Op.or]: [
          { createdAt: { [Op.lt]: new Date(before) } },
          ...(beforeId ? [{ createdAt: new Date(before), id: { [Op.lt]: beforeId } }] : []),
        ] } : {}),
      },
      include: [{ model: ConversationModel, where: { revokedAt: null }, required: true }],
      order: [["createdAt", "DESC"]],
      limit,
    });
    const ordered = rows.reverse();
    const events = await this.sequelize.query<TrainingInviteConversationEvent>(
      `SELECT id, conversation_id AS "conversationId",
              invitation_id AS "invitationId", accepted_revision AS "acceptedRevision",
              starts_at AS "startsAt", time_zone AS "timeZone", place_label AS "placeLabel",
              created_at AS "createdAt", cancelled_at AS "cancelledAt"
         FROM chat.conversation_events
        WHERE conversation_id = :conversationId
          AND (:before IS NULL OR created_at < :before)
        ORDER BY created_at DESC, id DESC
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { conversationId, before: before ?? null, limit } },
    );
    const timerEvents = await this.sequelize.query<DisappearingTimerEvent>(
      `SELECT id, conversation_id AS "conversationId", changed_by_user_id AS "changedByUserId",
              seconds, created_at AS "createdAt"
         FROM chat.conversation_timer_events
        WHERE conversation_id = :conversationId
          AND (:before IS NULL OR created_at < :before)
        ORDER BY created_at DESC, id DESC
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { conversationId, before: before ?? null, limit } },
    );
    const storyIds = [...new Set(ordered.map((message) => message.storyId).filter((id): id is string => Boolean(id)))];
    const availability = new Map<string, boolean>();
    if (storyIds.length > 0) {
      const storyRows = await this.sequelize.query<{ id: string; available: boolean }>(
        `SELECT id, (expires_at > :now AND hidden_at IS NULL) AS available
           FROM profile.stories
          WHERE id IN (:storyIds)`,
        { type: QueryTypes.SELECT, replacements: { now: new Date(), storyIds } },
      );
      for (const story of storyRows) availability.set(story.id, story.available);
    }
    // Una sola consulta batch por página (sin N+1). La ausencia de fila también
    // es false: una story purgada deja intactos texto y story_id del mensaje.
    const history: ConversationHistoryRecord[] = [
      ...ordered.map((message) => ({
        kind: "message" as const,
        message,
        ...(message.storyId ? { storyAvailable: availability.get(message.storyId) ?? false } : {}),
      })),
      ...events.map((event) => ({ kind: "system" as const, event })),
      ...timerEvents.map((event) => ({ kind: "timer" as const, event })),
    ];
    const createdAtOf = (record: ConversationHistoryRecord) =>
      new Date(record.kind === "message" ? record.message.createdAt : record.event.createdAt).getTime();
    return history
      .sort((left, right) => createdAtOf(left) - createdAtOf(right))
      .slice(-limit);
  }

  /** Las conversaciones de un usuario, con el otro participante y el último mensaje. */
  async listConversationsForUser(userId: string): Promise<ConversationSummaryRow[]> {
    return this.sequelize.query<ConversationSummaryRow>(
      `SELECT c.id AS conversation_id,
              other.user_id AS other_user_id,
              u.nombre_completo AS other_user_name,
              other_photo.url AS other_user_photo_url,
              u.last_seen_at AS other_user_last_seen_at,
              CASE WHEN last_msg.deleted_at IS NOT NULL THEN 'Mensaje eliminado' ELSE CASE last_msg.type
                WHEN 'image' THEN COALESCE(last_msg.body, 'Foto')
                WHEN 'video' THEN COALESCE(last_msg.body, 'Video')
                WHEN 'location' THEN 'Ubicación'
                WHEN 'sticker' THEN 'Sticker'
                ELSE last_msg.body
              END END AS last_message_body,
              last_msg.created_at AS last_message_at,
              mine.can_write AS can_write,
              c.system_kind AS system_kind,
              mine.nickname AS nickname,
              other.last_delivered_at AS other_last_delivered_at,
              CASE
                WHEN COALESCE(mine.read_receipts_enabled, mine_receipts.enabled, true)
                 AND COALESCE(other.read_receipts_enabled, other_receipts.enabled, true)
                THEN other.last_receipt_read_at
                ELSE NULL
              END AS other_last_read_at,
              GREATEST(
                CASE WHEN mine.read_receipts_enabled IS NOT NULL
                  THEN CASE WHEN mine.read_receipts_enabled THEN mine.read_receipts_enabled_since ELSE NULL END
                  ELSE CASE WHEN COALESCE(mine_receipts.enabled, true) THEN mine_receipts.enabled_since ELSE NULL END END,
                CASE WHEN other.read_receipts_enabled IS NOT NULL
                  THEN CASE WHEN other.read_receipts_enabled THEN other.read_receipts_enabled_since ELSE NULL END
                  ELSE CASE WHEN COALESCE(other_receipts.enabled, true) THEN other_receipts.enabled_since ELSE NULL END END
              ) AS other_read_receipts_enabled_since,
              c.disappearing_seconds AS disappearing_seconds
         FROM chat.conversations c
         JOIN chat.participants mine ON mine.conversation_id = c.id AND mine.user_id = :userId
         JOIN chat.participants other ON other.conversation_id = c.id AND other.user_id <> :userId
         LEFT JOIN chat.read_receipt_settings mine_receipts ON mine_receipts.user_id = mine.user_id
         LEFT JOIN chat.read_receipt_settings other_receipts ON other_receipts.user_id = other.user_id
         JOIN public.usuarios u ON u.id = other.user_id
         LEFT JOIN LATERAL (
           SELECT url FROM profile.photos p
            WHERE p.user_id = other.user_id
              AND p.hidden_at IS NULL
            ORDER BY p.position ASC LIMIT 1
         ) other_photo ON true
         LEFT JOIN LATERAL (
           SELECT item.body, item.type, item.created_at, item.deleted_at
             FROM (
               SELECT m.id, m.body, m.type, m.created_at, m.deleted_at
                 FROM chat.messages m
                WHERE m.conversation_id = c.id
                  AND (m.expires_at IS NULL OR m.expires_at > now())
                  AND NOT EXISTS (SELECT 1 FROM chat.message_visibility v WHERE v.message_id = m.id AND v.user_id = :userId)
               UNION ALL
               SELECT e.id,
                      CASE WHEN e.cancelled_at IS NULL THEN 'Entrenamiento acordado' ELSE 'Entrenamiento cancelado' END AS body,
                      'system'::text AS type, e.created_at, NULL::timestamptz AS deleted_at
                 FROM chat.conversation_events e
                WHERE e.conversation_id = c.id
               UNION ALL
               SELECT t.id,
                      CASE WHEN t.seconds IS NULL THEN 'Mensajes temporales desactivados' ELSE 'Mensajes temporales activados' END AS body,
                      'system'::text AS type, t.created_at, NULL::timestamptz AS deleted_at
                 FROM chat.conversation_timer_events t
                WHERE t.conversation_id = c.id
             ) item
            ORDER BY item.created_at DESC, item.id DESC LIMIT 1
         ) last_msg ON true
        WHERE c.revoked_at IS NULL
        ORDER BY (c.system_kind IS NULL) ASC,
                 CASE c.system_kind WHEN 'CORPORATE' THEN 0 WHEN 'TENANT_ADMIN' THEN 1 ELSE 2 END,
                 COALESCE(last_msg.created_at, c.created_at) DESC`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  /**
   * Matches (conexiones aceptadas) que esperan respuesta mía, del que más
   * espera al que menos: el último mensaje visible es de la otra persona, o
   * aún no hay ninguno. Fuera quedan los bloqueos en cualquier sentido, las
   * conversaciones revocadas y lo que lleva más de
   * `PENDING_REPLY_WINDOW_DAYS` en silencio (un match viejo sin mensajes no es
   * un recordatorio, es ruido).
   */
  async listPendingReplies(userId: string): Promise<PendingReplyRow[]> {
    return this.sequelize.query<PendingReplyRow>(
      `WITH matches AS (
         SELECT CASE WHEN cn.requester_id = :userId THEN cn.addressee_id ELSE cn.requester_id END AS other_id,
                COALESCE(cn.responded_at, cn.updated_at) AS matched_at
           FROM social.connections cn
          WHERE cn.status = 'ACCEPTED'
            AND (cn.requester_id = :userId OR cn.addressee_id = :userId)
       )
       SELECT m.other_id AS other_user_id,
              u.nombre_completo AS other_user_name,
              conv.id AS conversation_id,
              COALESCE(last_msg.created_at, m.matched_at) AS waiting_since
         FROM matches m
         JOIN public.usuarios u ON u.id = m.other_id
         LEFT JOIN LATERAL (
           SELECT c.id, c.revoked_at
             FROM chat.conversations c
             JOIN chat.participants mine ON mine.conversation_id = c.id AND mine.user_id = :userId
             JOIN chat.participants other ON other.conversation_id = c.id AND other.user_id = m.other_id
            WHERE c.system_kind IS NULL
            ORDER BY c.created_at DESC
            LIMIT 1
         ) conv ON true
         LEFT JOIN LATERAL (
           SELECT msg.sender_id, msg.created_at
             FROM chat.messages msg
            WHERE msg.conversation_id = conv.id
              AND msg.deleted_at IS NULL
              AND (msg.expires_at IS NULL OR msg.expires_at > now())
              AND NOT EXISTS (SELECT 1 FROM chat.message_visibility v WHERE v.message_id = msg.id AND v.user_id = :userId)
            ORDER BY msg.created_at DESC, msg.id DESC
            LIMIT 1
         ) last_msg ON true
        WHERE conv.revoked_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM social.user_blocks b
             WHERE (b.blocker_id = :userId AND b.blocked_id = m.other_id)
                OR (b.blocker_id = m.other_id AND b.blocked_id = :userId)
          )
          AND (
            (last_msg.sender_id IS NULL AND m.matched_at > now() - make_interval(days => :windowDays))
            OR (last_msg.sender_id = m.other_id AND last_msg.created_at > now() - make_interval(days => :windowDays))
          )
        ORDER BY waiting_since ASC, m.other_id ASC`,
      { type: QueryTypes.SELECT, replacements: { userId, windowDays: PENDING_REPLY_WINDOW_DAYS } },
    );
  }

  /**
   * Cambia el modo de mensajes temporales y deja el aviso en el historial, todo
   * bajo el bloqueo de la conversación (el mismo que usan enviar y revocar).
   * Volver a elegir el modo vigente no escribe nada ni repite el aviso.
   */
  async setDisappearingSeconds(
    conversationId: string,
    userId: string,
    seconds: number | null,
  ): Promise<{ seconds: number | null; event: DisappearingTimerEvent | null }> {
    return this.sequelize.transaction(async (transaction) => {
      const conversation = await this.conversations.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || conversation.revokedAt) throw new NotFoundException("Conversación no encontrada.");
      const participant = await this.participants.findOne({ where: { conversationId, userId }, transaction });
      if (!participant) throw new NotFoundException("Conversación no encontrada.");
      if (!participant.canWrite) throw new ForbiddenException("Esta conversación es de solo lectura.");
      if ((conversation.disappearingSeconds ?? null) === seconds) return { seconds, event: null };
      await conversation.update({ disappearingSeconds: seconds }, { transaction });
      const [row] = await this.sequelize.query<DisappearingTimerEvent>(
        `INSERT INTO chat.conversation_timer_events (conversation_id, changed_by_user_id, seconds)
         VALUES (:conversationId, :userId, :seconds)
         RETURNING id, conversation_id AS "conversationId", changed_by_user_id AS "changedByUserId",
                   seconds, created_at AS "createdAt"`,
        { type: QueryTypes.SELECT, replacements: { conversationId, userId, seconds }, transaction },
      );
      return { seconds, event: row ?? null };
    });
  }

  /**
   * Borra un lote de mensajes temporales ya caducados. La lectura ya los oculta
   * desde `expires_at`; esto es la higiene posterior. Un mensaje denunciado se
   * conserva para que moderación pueda revisarlo.
   */
  async purgeExpiredMessages(batchSize: number): Promise<number> {
    const rows = await this.sequelize.query<{ id: string }>(
      `DELETE FROM chat.messages
        WHERE id IN (
          SELECT m.id FROM chat.messages m
           WHERE m.expires_at IS NOT NULL AND m.expires_at <= now()
             AND NOT EXISTS (
               SELECT 1 FROM moderation.reports r
                WHERE r.target_kind = 'CHAT_MESSAGE' AND r.target_id = m.id
             )
           ORDER BY m.expires_at
           LIMIT :batchSize
        )
        RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { batchSize } },
    );
    return rows.length;
  }

  /** IDs de todas las conversaciones donde participa — para difundir presencia. */
  async conversationIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.sequelize.query<{ conversation_id: string }>(
      `SELECT p.conversation_id FROM chat.participants p
         JOIN chat.conversations c ON c.id = p.conversation_id
        WHERE p.user_id = :userId AND c.revoked_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows.map((row) => row.conversation_id);
  }
}
