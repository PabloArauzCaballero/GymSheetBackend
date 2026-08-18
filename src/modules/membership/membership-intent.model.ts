import {
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { MembershipModel } from "./membership.model";
import { MembershipPlanModel } from "./membership-plan.model";

@Table({
  tableName: "intents",
  schema: "membership",
  underscored: true,
  timestamps: true,
})
export class MembershipIntentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, field: "public_id" })
  declare publicId: string;
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;
  @ForeignKey(() => MembershipModel)
  @Column({ type: DataType.UUID, field: "membership_id" })
  declare membershipId: string | null;
  @ForeignKey(() => MembershipPlanModel)
  @Column({ type: DataType.UUID, field: "plan_id" })
  declare planId: string;
  @Column({ type: DataType.STRING(20), field: "intent_type" })
  declare intentType: "RENEWAL" | "EXTENSION";
  @Column(DataType.INTEGER) declare months: number;
  @Column(DataType.STRING(24)) declare status:
    | "PENDING_PAYMENT"
    | "CONFIRMED"
    | "CANCELLED"
    | "EXPIRED";
  @Column(DataType.STRING(20)) declare channel: "WHATSAPP" | "MANUAL";
  @Column({ type: DataType.STRING(120), field: "idempotency_key" })
  declare idempotencyKey: string;
  @Column({ type: DataType.UUID, field: "correlation_id" })
  declare correlationId: string;
  @Column({ type: DataType.DATE, field: "confirmed_at" })
  declare confirmedAt: Date | null;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
