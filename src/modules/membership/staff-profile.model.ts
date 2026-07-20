import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { EmploymentStatus, StaffPosition } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { StaffBranchScopeModel } from './staff-branch-scope.model';

@Table({ tableName: 'staff_profiles', schema: 'membership', underscored: true, timestamps: true })
export class StaffProfileModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare position: StaffPosition;

  @Default(EmploymentStatus.ACTIVE)
  @Column({ type: DataType.STRING(30), allowNull: false, field: 'employment_status' })
  declare employmentStatus: EmploymentStatus;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'hired_on' })
  declare hiredOn: string;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'terminated_on' })
  declare terminatedOn: string | null;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'unlimited_access' })
  declare unlimitedAccess: boolean;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @HasMany(() => StaffBranchScopeModel)
  declare branchScopes?: StaffBranchScopeModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
