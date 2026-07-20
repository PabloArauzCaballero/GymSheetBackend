import { Column, CreatedAt, DataType, Default, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';
import { EquipmentAssignmentModel } from '../facilities/equipment-assignment.model';
import { MaintenanceEventModel } from '../facilities/maintenance-event.model';

@Table({ tableName: 'equipos_gym', underscored: true, timestamps: true })
export class EquipmentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(140), allowNull: false, field: 'nombre' })
  declare name: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'tipo' })
  declare type: EquipmentType;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'descripcion' })
  declare description: string | null;

  @Default(EquipmentStatus.AVAILABLE)
  @Column({ type: DataType.STRING(30), allowNull: false, field: 'estado' })
  declare status: EquipmentStatus;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'asset_tag' })
  declare assetTag: string | null;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'serial_number' })
  declare serialNumber: string | null;

  @Column({ type: DataType.STRING(160), allowNull: true })
  declare manufacturer: string | null;

  @Column({ type: DataType.STRING(160), allowNull: true, field: 'model_name' })
  declare modelName: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'purchased_on' })
  declare purchasedOn: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'warranty_expires_on' })
  declare warrantyExpiresOn: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'service_interval_days' })
  declare serviceIntervalDays: number | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'next_service_on' })
  declare nextServiceOn: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'out_of_service_reason' })
  declare outOfServiceReason: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @HasMany(() => EquipmentAssignmentModel)
  declare roomAssignments?: EquipmentAssignmentModel[];

  @HasMany(() => MaintenanceEventModel)
  declare maintenanceEvents?: MaintenanceEventModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
