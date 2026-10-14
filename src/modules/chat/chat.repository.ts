import { chatRequestFingerprint } from "./chat-request-fingerprint";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { literal, Op, QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { ConversationModel } from "./conversation.model";
import { MessageVisibilityModel } from "./message-visibility.model";
import { lockSocialPairUsers } from "../social/social-pair-lock";
import { MessageModel, MessageType } from "./message.model";

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
  storyId?: string | null;
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
}

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

export type ConversationHistoryRecord =
  | { readonly kind: "message"; readonly message: MessageModel; readonly storyAvailable?: boolean }
  | { readonly kind: "system"; readonly event: TrainingInviteConversationEvent };

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
  ) {}

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
      return this.messages.create({ conversationId, senderId, ...fields }, { transaction });
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
          && existing.storyId === (fields.storyId ?? null);
        if (!samePayload) throw new ConflictException("El clientRequestId ya se usó para otro mensaje.");
        return { message: existing, created: false };
      }
      const message = await this.messages.create({
        conversationId, senderId, clientRequestId, ...fields, idempotencyBody: fields.body ?? null,
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

  /** SQL predicate applied before LIMIT; values are escaped by Sequelize. */
  private visibleTo(userId: string) {
    return { id: { [Op.notIn]: literal(`(
      SELECT message_id FROM chat.message_visibility WHERE user_id = ${this.sequelize.escape(userId)}
    )`) } };
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
    ];
    return history
      .sort((left, right) => {
        const leftDate = left.kind === "message" ? left.message.createdAt : left.event.createdAt;
        const rightDate = right.kind === "message" ? right.message.createdAt : right.event.createdAt;
        return leftDate.getTime() - rightDate.getTime();
      })
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
              ) AS other_read_receipts_enabled_since
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
                  AND NOT EXISTS (SELECT 1 FROM chat.message_visibility v WHERE v.message_id = m.id AND v.user_id = :userId)
               UNION ALL
               SELECT e.id,
                      CASE WHEN e.cancelled_at IS NULL THEN 'Entrenamiento acordado' ELSE 'Entrenamiento cancelado' END AS body,
                      'system'::text AS type, e.created_at, NULL::timestamptz AS deleted_at
                 FROM chat.conversation_events e
                WHERE e.conversation_id = c.id
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
