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
} from 'sequelize-typescript';
import { UserModel } from '../../users/user.model';
import { EntityPlanModel } from './entity-plan.model';

@Table({
  tableName: 'plan_price_history',
  schema: 'directory',
  underscored: true,
  timestamps: false,
})
export class PlanPriceHistoryModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => EntityPlanModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'plan_id' })
  declare planId: string;

  @BelongsTo(() => EntityPlanModel)
  declare plan?: EntityPlanModel;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false })
  declare price: string;

  @Column({ type: DataType.CHAR(3), allowNull: false })
  declare currency: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'effective_from' })
  declare effectiveFrom: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'effective_to' })
  declare effectiveTo: Date | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'changed_by_user_id' })
  declare changedByUserId: string;

  @BelongsTo(() => UserModel, { as: 'changedByUser', foreignKey: 'changedByUserId' })
  declare changedByUser?: UserModel;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'change_reason' })
  declare changeReason: string;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_promotional' })
  declare isPromotional: boolean;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
