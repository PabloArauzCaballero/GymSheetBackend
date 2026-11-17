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
} from 'sequelize-typescript';
import { MembershipModel } from '../../membership/membership.model';
import { UserModel } from '../../users/user.model';
import { DirectoryEntityModel } from '../directory-entity.model';
import { EntityPlanModel } from './entity-plan.model';
import { PlanPriceHistoryModel } from './plan-price-history.model';

export type PaymentOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_VERIFICATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type PaymentOrderMethod = 'QR' | 'CASH';

@Table({
  tableName: 'payment_orders',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class PaymentOrderModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(40), allowNull: false, unique: true, field: 'order_number' })
  declare orderNumber: string;

  @ForeignKey(() => DirectoryEntityModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'entity_id' })
  declare entityId: string;

  @BelongsTo(() => DirectoryEntityModel)
  declare entity?: DirectoryEntityModel;

  @ForeignKey(() => EntityPlanModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'plan_id' })
  declare planId: string;

  @BelongsTo(() => EntityPlanModel)
  declare plan?: EntityPlanModel;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'athlete_user_id' })
  declare athleteUserId: string;

  @BelongsTo(() => UserModel, { as: 'athlete', foreignKey: 'athleteUserId' })
  declare athlete?: UserModel;

  @ForeignKey(() => PlanPriceHistoryModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'price_history_id' })
  declare priceHistoryId: string;

  @BelongsTo(() => PlanPriceHistoryModel)
  declare priceHistory?: PlanPriceHistoryModel;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false })
  declare amount: string;

  @Default(1)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare quantity: number;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false, field: 'unit_amount' })
  declare unitAmount: string;

  @Default('QR')
  @Column({ type: DataType.STRING(4), allowNull: false })
  declare method: PaymentOrderMethod;

  @Column({ type: DataType.DATE, allowNull: true, field: 'expires_at' })
  declare expiresAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'cancelled_at' })
  declare cancelledAt: Date | null;

  @Column({ type: DataType.STRING(24), allowNull: true, field: 'cancel_reason' })
  declare cancelReason: string | null;

  /** Private encrypted receipt (ADR-0024): `orders/{orderId}/receipt/{uuid}.bin`. */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'receipt_private_key' })
  declare receiptPrivateKey: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true, field: 'receipt_mime' })
  declare receiptMime: string | null;

  @Column({ type: DataType.CHAR(64), allowNull: true, field: 'receipt_sha256' })
  declare receiptSha256: string | null;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'receipt_attempts' })
  declare receiptAttempts: number;

  /** Units of the listing's stock this order holds reserved (0 once released or consumed). */
  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'stock_reserved_units' })
  declare stockReservedUnits: number;

  @Column({ type: DataType.STRING(16), allowNull: true, field: 'rejection_code' })
  declare rejectionCode: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'decided_by_user_id' })
  declare decidedByUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'decided_at' })
  declare decidedAt: Date | null;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'reminders_sent' })
  declare remindersSent: number;

  @Column({ type: DataType.CHAR(3), allowNull: false })
  declare currency: string;

  @Column({ type: DataType.JSONB, allowNull: false, field: 'plan_snapshot' })
  declare planSnapshot: Record<string, unknown>;

  @Default('PENDING_PAYMENT')
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: PaymentOrderStatus;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'receipt_url' })
  declare receiptUrl: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'receipt_storage_key' })
  declare receiptStorageKey: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'receipt_reference' })
  declare receiptReference: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'athlete_notes' })
  declare athleteNotes: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'submitted_at' })
  declare submittedAt: Date | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'verified_by_user_id' })
  declare verifiedByUserId: string | null;

  @BelongsTo(() => UserModel, { as: 'verifiedBy', foreignKey: 'verifiedByUserId' })
  declare verifiedBy?: UserModel | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'verified_at' })
  declare verifiedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'rejection_reason' })
  declare rejectionReason: string | null;

  @ForeignKey(() => MembershipModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'membership_id' })
  declare membershipId: string | null;

  @BelongsTo(() => MembershipModel)
  declare membership?: MembershipModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
