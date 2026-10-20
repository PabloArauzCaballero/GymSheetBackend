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
  | 'CANCELLED';

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
