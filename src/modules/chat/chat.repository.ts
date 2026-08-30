import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { ConversationModel } from "./conversation.model";
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
}

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
  ) {}

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
        WHERE p1.user_id = :userA AND p2.user_id = :userB
          AND (SELECT COUNT(*) FROM chat.participants p3 WHERE p3.conversation_id = p1.conversation_id) = 2
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userA, userB } },
    );
    return rows[0]?.conversation_id ?? null;
  }

  async createDirectConversation(userA: string, userB: string): Promise<string> {
    return this.sequelize.transaction(async (transaction) => {
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

  isParticipant(conversationId: string, userId: string): Promise<boolean> {
    return this.participants
      .count({ where: { conversationId, userId } })
      .then((count) => count > 0);
  }

  getParticipant(conversationId: string, userId: string): Promise<ConversationParticipantModel | null> {
    return this.participants.findOne({ where: { conversationId, userId } });
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

  /** Leer implica haber recibido: adelanta ambos cursores a la vez. */
  async markRead(conversationId: string, userId: string): Promise<void> {
    const now = new Date();
    await this.participants.update(
      { lastReadAt: now, lastDeliveredAt: now },
      { where: { conversationId, userId } },
    );
  }

  createMessage(conversationId: string, senderId: string, fields: MessageCreateFields): Promise<MessageModel> {
    return this.messages.create({ conversationId, senderId, ...fields });
  }

  getMessage(conversationId: string, messageId: string): Promise<MessageModel | null> {
    return this.messages.findOne({ where: { id: messageId, conversationId } });
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
    const [, affectedRows] = await this.messages.update(
      { viewedAt: new Date() },
      {
        where: {
          id: messageId,
          conversationId,
          viewOnce: true,
          viewedAt: null,
          senderId: { [Op.ne]: viewerId },
        },
        returning: true,
      },
    );
    return affectedRows[0] ?? null;
  }

  async listMessages(
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<MessageModel[]> {
    const rows = await this.messages.findAll({
      where: { conversationId, ...(before ? { createdAt: { [Op.lt]: new Date(before) } } : {}) },
      order: [["createdAt", "DESC"]],
      limit,
    });
    return rows.reverse();
  }

  /** Las conversaciones de un usuario, con el otro participante y el último mensaje. */
  async listConversationsForUser(userId: string): Promise<ConversationSummaryRow[]> {
    return this.sequelize.query<ConversationSummaryRow>(
      `SELECT c.id AS conversation_id,
              other.user_id AS other_user_id,
              u.nombre_completo AS other_user_name,
              other_photo.url AS other_user_photo_url,
              u.last_seen_at AS other_user_last_seen_at,
              CASE last_msg.type
                WHEN 'image' THEN COALESCE(last_msg.body, 'Foto')
                WHEN 'video' THEN COALESCE(last_msg.body, 'Video')
                WHEN 'location' THEN 'Ubicación'
                ELSE last_msg.body
              END AS last_message_body,
              last_msg.created_at AS last_message_at,
              mine.can_write AS can_write,
              c.system_kind AS system_kind,
              mine.nickname AS nickname,
              other.last_delivered_at AS other_last_delivered_at,
              other.last_read_at AS other_last_read_at
         FROM chat.conversations c
         JOIN chat.participants mine ON mine.conversation_id = c.id AND mine.user_id = :userId
         JOIN chat.participants other ON other.conversation_id = c.id AND other.user_id <> :userId
         JOIN public.usuarios u ON u.id = other.user_id
         LEFT JOIN LATERAL (
           SELECT url FROM profile.photos p
            WHERE p.user_id = other.user_id
            ORDER BY p.position ASC LIMIT 1
         ) other_photo ON true
         LEFT JOIN LATERAL (
           SELECT body, type, created_at FROM chat.messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC LIMIT 1
         ) last_msg ON true
        ORDER BY (c.system_kind IS NULL) ASC,
                 CASE c.system_kind WHEN 'CORPORATE' THEN 0 WHEN 'TENANT_ADMIN' THEN 1 ELSE 2 END,
                 COALESCE(last_msg.created_at, c.created_at) DESC`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  /** IDs de todas las conversaciones donde participa — para difundir presencia. */
  async conversationIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.participants.findAll({
      attributes: ["conversationId"],
      where: { userId },
      raw: true,
    });
    return rows.map((row) => row.conversationId);
  }
}
