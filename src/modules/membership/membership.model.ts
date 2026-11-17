import {
  BelongsTo,
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
import { MembershipStatus } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";

export type PeriodOrigin = "MARKETPLACE" | "LEGACY";

/**
 * One subscription period (ADR-0026): a confirmed marketplace order of a
 * listing, or a LEGACY row of the gym-operated memberships that came before.
 * `retired_plan_id` points at the retired global catalogue and is only kept
 * for the history of legacy rows.
 */
@Table({
  tableName: "memberships",
  schema: "membership",
  underscored: true,
  timestamps: true,
})
export class MembershipModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.UUID, allowNull: true, field: "retired_plan_id" })
  declare retiredPlanId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "entity_id" })
  declare entityId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "entity_plan_id" })
  declare entityPlanId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "payment_order_id" })
  declare paymentOrderId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "affiliation_id" })
  declare affiliationId: string | null;

  @Column({ type: DataType.STRING(20), allowNull: false, field: "offer_kind" })
  declare offerKind: string;

  @Column({ type: DataType.STRING(180), allowNull: false, field: "plan_name" })
  declare planName: string;

  @Column({ type: DataType.INTEGER, allowNull: true, field: "sessions_total" })
  declare sessionsTotal: number | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: "sessions_used" })
  declare sessionsUsed: number;

  @Default("LEGACY")
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare origin: PeriodOrigin;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: "starts_on" })
  declare startsOn: string;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: "ends_on" })
  declare endsOn: string | null;

  @Default(MembershipStatus.ACTIVE)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: MembershipStatus;

  @Column({
    type: DataType.STRING(180),
    allowNull: true,
    field: "external_reference",
  })
  declare externalReference: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: "created_by_user_id" })
  declare createdByUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "cancelled_at" })
  declare cancelledAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "suspended_at" })
  declare suspendedAt: Date | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel, "userId")
  declare user?: UserModel;

  @BelongsTo(() => UserModel, "createdByUserId")
  declare createdByUser?: UserModel | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
