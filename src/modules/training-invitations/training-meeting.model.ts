import {
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";

@Table({
  tableName: "training_invite_meetings",
  schema: "training",
  underscored: true,
  timestamps: false,
})
export class TrainingMeetingModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: "invite_id" })
  declare inviteId: string;

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

  @Column({ type: DataType.DATE, allowNull: true, field: "cancelled_at" })
  declare cancelledAt: Date | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
