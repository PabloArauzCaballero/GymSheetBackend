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

  @Default('USD')
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
