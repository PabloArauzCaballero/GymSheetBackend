import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";

export type TrainingInviteState =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED";

@Table({
  tableName: "training_invites",
  schema: "training",
  underscored: true,
  timestamps: true,
})
export class TrainingInviteModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: "inviter_id" })
  declare inviterId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: "recipient_id" })
  declare recipientId: string;

  @Default("PENDING")
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare state: TrainingInviteState;

  @Default(1)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: "current_revision",
  })
  declare currentRevision: number;

  @Column({ type: DataType.UUID, allowNull: false, field: "client_request_id" })
  declare clientRequestId: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    field: "request_fingerprint",
  })
  declare requestFingerprint: string;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
