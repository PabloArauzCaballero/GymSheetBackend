import {
  BelongsTo,
  BelongsToMany,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  HasOne,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { BranchModel } from '../facilities/branch.model';
import { TenantModel } from '../tenants/tenant.model';
import { UserModel } from '../users/user.model';
import { CategoryModel } from './category.model';
import { DirectoryEntityCategoryModel } from './directory-entity-category.model';
import { DirectoryReviewModel } from './directory-review.model';
import { EntityPaymentConfigModel } from './models/entity-payment-config.model';
import { EntityPlanModel } from './models/entity-plan.model';
import { PaymentOrderModel } from './models/payment-order.model';

export type DirectoryEntityType =
  | 'GYM'
  | 'COACH'
  | 'CENTER'
  | 'STORE'
  | 'SERVICE_PROVIDER';

export type DirectoryEntityStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED';

@Table({
  tableName: 'entities',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class DirectoryEntityModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(120), allowNull: false, unique: true })
  declare slug: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'entity_type' })
  declare entityType: DirectoryEntityType;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare headline: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @ForeignKey(() => CategoryModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'primary_category_id' })
  declare primaryCategoryId: string;

  @BelongsTo(() => CategoryModel, { as: 'primaryCategory', foreignKey: 'primaryCategoryId' })
  declare primaryCategory?: CategoryModel;

  @BelongsToMany(() => CategoryModel, () => DirectoryEntityCategoryModel)
  declare secondaryCategories?: CategoryModel[];

  @ForeignKey(() => TenantModel)
  @Column({ type: DataType.STRING(60), allowNull: true, field: 'tenant_id' })
  declare tenantId: string | null;

  @BelongsTo(() => TenantModel)
  declare tenant?: TenantModel | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'user_id' })
  declare userId: string | null;

  @BelongsTo(() => UserModel)
  declare user?: UserModel | null;

  @ForeignKey(() => BranchModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'branch_id' })
  declare branchId: string | null;

  @BelongsTo(() => BranchModel)
  declare branch?: BranchModel | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'logo_url' })
  declare logoUrl: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'cover_url' })
  declare coverUrl: string | null;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false })
  declare gallery: string[];

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_online_only' })
  declare isOnlineOnly: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare address: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare city: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare country: string | null;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: true })
  declare latitude: string | null;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: true })
  declare longitude: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'contact_info' })
  declare contactInfo: Record<string, string>;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'business_hours' })
  declare businessHours: Record<string, { open: string; close: string }>;

  @Default(0.0)
  @Column({ type: DataType.DECIMAL(3, 2), allowNull: false, field: 'rating_average' })
  declare ratingAverage: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'rating_count' })
  declare ratingCount: number;

  @Default({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 })
  @Column({ type: DataType.JSONB, allowNull: false, field: 'rating_breakdown' })
  declare ratingBreakdown: { '1': number; '2': number; '3': number; '4': number; '5': number };

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_verified' })
  declare isVerified: boolean;

  @Default('ACTIVE')
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: DirectoryEntityStatus;

  @HasMany(() => DirectoryReviewModel)
  declare reviews?: DirectoryReviewModel[];

  @HasOne(() => EntityPaymentConfigModel)
  declare paymentConfig?: EntityPaymentConfigModel;

  @HasMany(() => EntityPlanModel)
  declare plans?: EntityPlanModel[];

  @HasMany(() => PaymentOrderModel)
  declare paymentOrders?: PaymentOrderModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
