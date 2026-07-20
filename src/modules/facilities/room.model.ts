import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { RoomStatus, RoomType } from '../../common/enums/domain.enums';
import { AccessPointModel } from './access-point.model';
import { BranchModel } from './branch.model';
import { EquipmentAssignmentModel } from './equipment-assignment.model';

@Table({ tableName: 'rooms', schema: 'facilities', underscored: true, timestamps: true })
export class RoomModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => BranchModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'branch_id' })
  declare branchId: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'room_type' })
  declare roomType: RoomType;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare capacity: number | null;

  @Default(RoomStatus.ACTIVE)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: RoomStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => BranchModel)
  declare branch?: BranchModel;

  @HasMany(() => EquipmentAssignmentModel)
  declare equipmentAssignments?: EquipmentAssignmentModel[];

  @HasMany(() => AccessPointModel)
  declare accessPoints?: AccessPointModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
