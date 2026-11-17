import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { DirectoryEntityModel } from '../directory-entity.model';
import { PlanPriceHistoryModel } from './plan-price-history.model';

export type EntityPlanType = 'MEMBERSHIP_PLAN' | 'PASS' | 'SERVICE' | 'PRODUCT';
export type EntityPlanStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ListingOfferKind =
  | 'MEMBERSHIP'
  | 'DAY_PASS'
  | 'MULTI_DAY_PASS'
  | 'CLASS_PACK'
  | 'PRODUCT'
  | 'SERVICE_SESSION'
  | 'SERVICE_PACK';
/** Post-moderation state (ADR-0022): only LIVE is public; HELD/HIDDEN/REJECTED are not. */
export type ListingModerationStatus = 'LIVE' | 'HELD' | 'HIDDEN' | 'REJECTED';

@Table({
  tableName: 'entity_plans',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class EntityPlanModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => DirectoryEntityModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'entity_id' })
  declare entityId: string;

  @BelongsTo(() => DirectoryEntityModel)
  declare entity?: DirectoryEntityModel;

  @Default('MEMBERSHIP_PLAN')
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare type: EntityPlanType;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare slug: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false })
  declare benefits: string[];

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'duration_days' })
  declare durationDays: number | null;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false, field: 'current_price' })
  declare currentPrice: string;

  /** `type` is derived from this (ck_entity_plan_type_of_kind). */
  @Column({ type: DataType.STRING(20), allowNull: false, field: 'offer_kind' })
  declare offerKind: ListingOfferKind;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'sessions_count' })
  declare sessionsCount: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'stock_quantity' })
  declare stockQuantity: number | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'stock_reserved' })
  declare stockReserved: number;

  @Column({ type: DataType.UUID, allowNull: true, field: 'product_category_id' })
  declare productCategoryId: string | null;

  @Default('HELD')
  @Column({ type: DataType.STRING(10), allowNull: false, field: 'moderation_status' })
  declare moderationStatus: ListingModerationStatus;

  @Column({ type: DataType.STRING(40), allowNull: true, field: 'moderation_reason_code' })
  declare moderationReasonCode: string | null;

  @Default([])
  @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: false, field: 'auto_check_codes' })
  declare autoCheckCodes: string[];

  @Column({ type: DataType.DATE, allowNull: true, field: 'published_at' })
  declare publishedAt: Date | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'moderated_by_user_id' })
  declare moderatedByUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'moderated_at' })
  declare moderatedAt: Date | null;

  @Default('BOB')
  @Column({ type: DataType.CHAR(3), allowNull: false })
  declare currency: string;

  @Default('ACTIVE')
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: EntityPlanStatus;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'display_order' })
  declare displayOrder: number;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false, field: 'media_urls' })
  declare mediaUrls: string[];

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @HasMany(() => PlanPriceHistoryModel)
  declare priceHistories?: PlanPriceHistoryModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
