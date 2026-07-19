import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { AccessDeviceStatus } from '../../common/enums/domain.enums';
import { AccessPointModel } from '../facilities/access-point.model';
import { AccessDeviceEventModel } from './access-device-event.model';

@Table({ tableName: 'devices', schema: 'access_control', underscored: true, timestamps: true })
export class AccessDeviceModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => AccessPointModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'access_point_id' })
  declare accessPointId: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'adapter_key' })
  declare adapterKey: string;

  @Column({ type: DataType.STRING(180), allowNull: false, field: 'external_device_id' })
  declare externalDeviceId: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Default(AccessDeviceStatus.ACTIVE)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: AccessDeviceStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_seen_at' })
  declare lastSeenAt: Date | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => AccessPointModel)
  declare accessPoint?: AccessPointModel;

  @HasMany(() => AccessDeviceEventModel)
  declare events?: AccessDeviceEventModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
