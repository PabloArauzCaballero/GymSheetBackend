import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { BranchModel } from '../facilities/branch.model';
import { StaffProfileModel } from './staff-profile.model';

@Table({ tableName: 'staff_branch_scopes', schema: 'membership', underscored: true, timestamps: true })
export class StaffBranchScopeModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => StaffProfileModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'staff_profile_id' })
  declare staffProfileId: string;

  @ForeignKey(() => BranchModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'branch_id' })
  declare branchId: string;

  @BelongsTo(() => StaffProfileModel)
  declare staffProfile?: StaffProfileModel;

  @BelongsTo(() => BranchModel)
  declare branch?: BranchModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
