import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { MaintenanceStatus, MaintenanceType } from '../../common/enums/domain.enums';
import { EquipmentModel } from '../equipment/equipment.model';
import { UserModel } from '../users/user.model';

@Table({ tableName: 'maintenance_events', schema: 'facilities', underscored: true, timestamps: true })
export class MaintenanceEventModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => EquipmentModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'equipment_id' })
  declare equipmentId: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'maintenance_type' })
  declare maintenanceType: MaintenanceType;

  @Default(MaintenanceStatus.SCHEDULED)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: MaintenanceStatus;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'scheduled_for' })
  declare scheduledFor: string;

  @Column({ type: DataType.DATE, allowNull: true, field: 'started_at' })
  declare startedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'completed_at' })
  declare completedAt: Date | null;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'vendor_name' })
  declare vendorName: string | null;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'technician_name' })
  declare technicianName: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare findings: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare resolution: string | null;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true, field: 'cost_amount' })
  declare costAmount: string | null;

  @Column({ type: DataType.CHAR(3), allowNull: true, field: 'cost_currency' })
  declare costCurrency: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'created_by_user_id' })
  declare createdByUserId: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => EquipmentModel)
  declare equipment?: EquipmentModel;

  @BelongsTo(() => UserModel)
  declare createdByUser?: UserModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
