import { Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { MessageModel } from "./message.model";

/** A durable, private hide marker: the underlying shared message is unchanged. */
@Table({ tableName: "message_visibility", schema: "chat", underscored: true, timestamps: false })
export class MessageVisibilityModel extends Model {
  @PrimaryKey
  @ForeignKey(() => MessageModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "message_id" })
  declare messageId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: "hidden_at" })
  declare hiddenAt: Date;
}
