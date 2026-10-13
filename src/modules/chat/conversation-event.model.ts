import {
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";

@Table({
  tableName: "conversation_events",
  schema: "chat",
  underscored: true,
  timestamps: false,
})
export class ConversationEventModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: "conversation_id" })
  declare conversationId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: "invitation_id" })
  declare invitationId: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: "accepted_revision",
  })
  declare acceptedRevision: number;

  @Column({ type: DataType.DATE, allowNull: false, field: "starts_at" })
  declare startsAt: Date;

  @Column({ type: DataType.STRING(80), allowNull: false, field: "time_zone" })
  declare timeZone: string;

  @Column({
    type: DataType.STRING(180),
    allowNull: false,
    field: "place_label",
  })
  declare placeLabel: string;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
