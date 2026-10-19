import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { ConversationModel } from "./conversation.model";

export type MessageType = "text" | "image" | "video" | "audio" | "location" | "sticker";

@Table({ tableName: "messages", schema: "chat", underscored: true, timestamps: false })
export class MessageModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => ConversationModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "conversation_id" })
  declare conversationId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "sender_id" })
  declare senderId: string;

  /** Nullable so messages written before idempotency keys remain valid. */
  @Column({ type: DataType.UUID, allowNull: true, field: "client_request_id" })
  declare clientRequestId: string | null;

  /** Original send body for retry validation; edits only change body/editedAt. */
  @Column({ type: DataType.TEXT, allowNull: true, field: "idempotency_body" })
  declare idempotencyBody: string | null;

  /** Stable story ID for a reply; intentionally no FK so expired/purged stories can render unavailable. */
  @Column({ type: DataType.UUID, allowNull: true, field: "story_id" })
  declare storyId: string | null;

  /** `null` para tipos sin texto propio (una ubicación, o una foto sin pie de foto). */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare body: string | null;

  @Default("text")
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare type: MessageType;

  @Column({ type: DataType.STRING(20), allowNull: true, field: "media_provider" })
  declare mediaProvider: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: "media_key" })
  declare mediaKey: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: "media_url" })
  declare mediaUrl: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: "media_mime_type" })
  declare mediaMimeType: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: "media_size_bytes" })
  declare mediaSizeBytes: number | null;

  /** Foto/video que solo puede abrirse una vez — ver `viewedAt`. */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: "view_once" })
  declare viewOnce: boolean;

  /** Cuándo se consumió la vista única. `null` = todavía disponible. */
  @Column({ type: DataType.DATE, allowNull: true, field: "viewed_at" })
  declare viewedAt: Date | null;

  @Column({ type: DataType.DOUBLE, allowNull: true, field: "location_lat" })
  declare locationLat: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true, field: "location_lng" })
  declare locationLng: number | null;

  /** Nombre del lugar elegido en el mapa («Gimnasio X · Calle Y»); `null` para «mi ubicación». */
  @Column({ type: DataType.STRING(180), allowNull: true, field: "location_label" })
  declare locationLabel: string | null;

  /** Mensaje temporal: deja de verse para ambos a esta hora y la purga lo borra después. */
  @Column({ type: DataType.DATE, allowNull: true, field: "expires_at" })
  declare expiresAt: Date | null;

  /** Mensaje citado al responder; `null` si no es respuesta o si el original ya se purgó. */
  @Column({ type: DataType.UUID, allowNull: true, field: "reply_to_id" })
  declare replyToId: string | null;

  /** Copia de un mensaje de otra conversación («Reenviado»). */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare forwarded: boolean;

  @BelongsTo(() => ConversationModel)
  declare conversation?: ConversationModel;

  /** Non-null marks an accepted text edit; the original createdAt never changes. */
  @Column({ type: DataType.DATE, allowNull: true, field: "edited_at" })
  declare editedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "deleted_at" })
  declare deletedAt: Date | null;

  @Column({ type: DataType.STRING(67), allowNull: true, field: "deleted_request_hash" })
  declare deletedRequestHash: string | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
