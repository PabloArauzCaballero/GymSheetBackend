import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { MembershipStatus } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { MembershipPlanModel } from './membership-plan.model';

@Table({ tableName: 'memberships', schema: 'membership', underscored: true, timestamps: true })
export class MembershipModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @ForeignKey(() => MembershipPlanModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'plan_id' })
  declare planId: string;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'starts_on' })
  declare startsOn: string;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'ends_on' })
  declare endsOn: string;

  @Default(MembershipStatus.ACTIVE)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: MembershipStatus;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'external_reference' })
  declare externalReference: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'created_by_user_id' })
  declare createdByUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'cancelled_at' })
  declare cancelledAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'suspended_at' })
  declare suspendedAt: Date | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel, 'userId')
  declare user?: UserModel;

  @BelongsTo(() => MembershipPlanModel)
  declare plan?: MembershipPlanModel;

  @BelongsTo(() => UserModel, 'createdByUserId')
  declare createdByUser?: UserModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
