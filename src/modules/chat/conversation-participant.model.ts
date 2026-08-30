import { BelongsTo, Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { ConversationModel } from "./conversation.model";

@Table({ tableName: "participants", schema: "chat", underscored: true, timestamps: false })
export class ConversationParticipantModel extends Model {
  @PrimaryKey
  @ForeignKey(() => ConversationModel)
  @Column({ type: DataType.UUID, field: "conversation_id" })
  declare conversationId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.DATE, field: "joined_at" })
  declare joinedAt: Date;

  /** `false` en el lado regular de un chat de sistema de solo lectura. */
  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: "can_write" })
  declare canWrite: boolean;

  /** Cómo ESTE participante llama a la conversación. Privado: solo él lo ve. */
  @Column({ type: DataType.STRING(60), allowNull: true })
  declare nickname: string | null;

  /** Hasta cuándo este participante recibió mensajes (cursor, no por mensaje). */
  @Column({ type: DataType.DATE, allowNull: true, field: "last_delivered_at" })
  declare lastDeliveredAt: Date | null;

  /** Hasta cuándo este participante leyó mensajes (cursor, no por mensaje). */
  @Column({ type: DataType.DATE, allowNull: true, field: "last_read_at" })
  declare lastReadAt: Date | null;

  @BelongsTo(() => ConversationModel)
  declare conversation?: ConversationModel;
}
