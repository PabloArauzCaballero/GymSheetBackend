import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { BranchModel } from '../facilities/branch.model';
import { RoomModel } from '../facilities/room.model';
import { MembershipPlanModel } from './membership-plan.model';

@Table({ tableName: 'plan_access_scopes', schema: 'membership', underscored: true, timestamps: true })
export class PlanAccessScopeModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => MembershipPlanModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'plan_id' })
  declare planId: string;

  @ForeignKey(() => BranchModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'branch_id' })
  declare branchId: string;

  @ForeignKey(() => RoomModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'room_id' })
  declare roomId: string | null;

  @BelongsTo(() => MembershipPlanModel)
  declare plan?: MembershipPlanModel;

  @BelongsTo(() => BranchModel)
  declare branch?: BranchModel;

  @BelongsTo(() => RoomModel)
  declare room?: RoomModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
