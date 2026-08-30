import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { ConversationModel } from "./conversation.model";

export type MessageType = "text" | "image" | "video" | "location";

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

  @BelongsTo(() => ConversationModel)
  declare conversation?: ConversationModel;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
