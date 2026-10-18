import { Column, CreatedAt, DataType, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { MessageModel } from "./message.model";

/** Una reacción por persona y mensaje, como WhatsApp: reaccionar de nuevo la reemplaza. */
@Table({ tableName: "message_reactions", schema: "chat", underscored: true, timestamps: true })
export class MessageReactionModel extends Model {
  @PrimaryKey
  @ForeignKey(() => MessageModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "message_id" })
  declare messageId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare emoji: string;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
