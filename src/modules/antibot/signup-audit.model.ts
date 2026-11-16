import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table } from "sequelize-typescript";
import type { SignupChannel, SignupRejectReason, SignupRisk } from "./signup-protection.types";

/** Append-only record of every signup verdict, accepted or rejected. */
@Table({ tableName: "signup_audit", schema: "auth", underscored: true, timestamps: true, updatedAt: false })
export class SignupAuditModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: true, field: "user_id" })
  declare userId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "ticket_id" })
  declare ticketId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "started_at" })
  declare startedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: false, field: "completed_at" })
  declare completedAt: Date;

  @Column({ type: DataType.INTEGER, allowNull: true, field: "duration_ms" })
  declare durationMs: number | null;

  @Column({ type: DataType.STRING(10), allowNull: false })
  declare channel: SignupChannel;

  @Column({ type: DataType.STRING(10), allowNull: false })
  declare risk: SignupRisk;

  @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: false, field: "risk_reasons" })
  declare riskReasons: string[];

  @Column({ type: DataType.STRING(30), allowNull: true, field: "reject_reason" })
  declare rejectReason: SignupRejectReason | null;

  @Column({ type: DataType.STRING(64), allowNull: true, field: "ip_hmac" })
  declare ipHmac: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true, field: "installation_id" })
  declare installationId: string | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
