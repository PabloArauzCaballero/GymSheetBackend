import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { EquipmentModel } from '../equipment/equipment.model';
import { UserModel } from '../users/user.model';
import { RoomModel } from './room.model';

@Table({ tableName: 'equipment_assignments', schema: 'facilities', underscored: true, timestamps: true })
export class EquipmentAssignmentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => EquipmentModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'equipment_id' })
  declare equipmentId: string;

  @ForeignKey(() => RoomModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'room_id' })
  declare roomId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'assigned_at' })
  declare assignedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'ended_at' })
  declare endedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'assigned_by_user_id' })
  declare assignedByUserId: string | null;

  @BelongsTo(() => EquipmentModel)
  declare equipment?: EquipmentModel;

  @BelongsTo(() => RoomModel)
  declare room?: RoomModel;

  @BelongsTo(() => UserModel)
  declare assignedByUser?: UserModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
