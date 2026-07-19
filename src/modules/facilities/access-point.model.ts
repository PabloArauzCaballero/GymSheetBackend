import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { AccessDirection, FacilityStatus } from '../../common/enums/domain.enums';
import { BranchModel } from './branch.model';
import { RoomModel } from './room.model';

@Table({ tableName: 'access_points', schema: 'facilities', underscored: true, timestamps: true })
export class AccessPointModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => BranchModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'branch_id' })
  declare branchId: string;

  @ForeignKey(() => RoomModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'room_id' })
  declare roomId: string | null;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Default(AccessDirection.BOTH)
  @Column({ type: DataType.STRING(20), allowNull: false, field: 'allowed_direction' })
  declare allowedDirection: AccessDirection;

  @Default(FacilityStatus.ACTIVE)
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: FacilityStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

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
