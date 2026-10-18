import { Column, CreatedAt, DataType, Default, HasMany, Model, PrimaryKey, Table } from "sequelize-typescript";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { MessageModel } from "./message.model";

@Table({ tableName: "conversations", schema: "chat", underscored: true, timestamps: false })
export class ConversationModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  /**
   * `null` para un chat normal entre socios. `CORPORATE`/`TENANT_ADMIN` fija
   * la conversación arriba de la lista y marca al otro lado como el único que
   * puede escribir (ver `ConversationParticipantModel.canWrite`).
   */
  @Column({ type: DataType.STRING(20), allowNull: true, field: "system_kind" })
  declare systemKind: "CORPORATE" | "TENANT_ADMIN" | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "revoked_at" })
  declare revokedAt: Date | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "revoked_by_user_id" })
  declare revokedByUserId: string | null;

  /** Mensajes temporales: segundos de vida de lo que se envíe (24 h, 7 días o 90 días); `null` = desactivado. */
  @Column({ type: DataType.INTEGER, allowNull: true, field: "disappearing_seconds" })
  declare disappearingSeconds: number | null;

  @HasMany(() => ConversationParticipantModel)
  declare participants?: ConversationParticipantModel[];

  @HasMany(() => MessageModel)
  declare messages?: MessageModel[];

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
