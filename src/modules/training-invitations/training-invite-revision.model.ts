import {
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";

@Table({
  tableName: "training_invite_revisions",
  schema: "training",
  underscored: true,
  timestamps: false,
})
export class TrainingInviteRevisionModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, allowNull: false, field: "invite_id" })
  declare inviteId: string;

  @PrimaryKey
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare revision: number;

  @Column({ type: DataType.UUID, allowNull: false, field: "proposer_id" })
  declare proposerId: string;

  @Column({ type: DataType.DATE, allowNull: false, field: "starts_at" })
  declare startsAt: Date;

  @Column({ type: DataType.STRING(80), allowNull: false, field: "time_zone" })
  declare timeZone: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: "duration_minutes",
  })
  declare durationMinutes: number;

  @Column({ type: DataType.STRING(16), allowNull: false, field: "place_kind" })
  declare placeKind: "GYM" | "PUBLIC_PLACE";

  @Column({ type: DataType.UUID, allowNull: true, field: "place_id" })
  declare placeId: string | null;

  @Column({
    type: DataType.STRING(180),
    allowNull: false,
    field: "place_label",
  })
  declare placeLabel: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare mode: "OWN_ROUTINES" | "SHARED_SESSION";

  @Column({ type: DataType.UUID, allowNull: true, field: "routine_session_id" })
  declare routineSessionId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare note: string | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
