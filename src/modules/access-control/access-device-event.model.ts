import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasOne, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { AccessDirection, QueueItemStatus } from '../../common/enums/domain.enums';
import { AccessCredentialModel } from './access-credential.model';
import { AccessDecisionModel } from './access-decision.model';
import { AccessDeviceModel } from './access-device.model';

@Table({ tableName: 'device_events', schema: 'access_control', underscored: true, timestamps: true })
export class AccessDeviceEventModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => AccessDeviceModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'device_id' })
  declare deviceId: string;

  @Column({ type: DataType.STRING(200), allowNull: false, field: 'source_event_id' })
  declare sourceEventId: string;

  @ForeignKey(() => AccessCredentialModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'credential_id' })
  declare credentialId: string;

  @Column({ type: DataType.STRING(20), allowNull: false, field: 'requested_direction' })
  declare requestedDirection: AccessDirection.ENTRY | AccessDirection.EXIT;

  @Column({ type: DataType.DATE, allowNull: false, field: 'occurred_at' })
  declare occurredAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'received_at' })
  declare receivedAt: Date;

  @Default(QueueItemStatus.PENDING)
  @Column({ type: DataType.STRING(30), allowNull: false, field: 'queue_status' })
  declare queueStatus: QueueItemStatus;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'attempt_count' })
  declare attemptCount: number;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'available_at' })
  declare availableAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'locked_at' })
  declare lockedAt: Date | null;

  @Column({ type: DataType.STRING(160), allowNull: true, field: 'locked_by' })
  declare lockedBy: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'completed_at' })
  declare completedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'last_error' })
  declare lastError: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => AccessDeviceModel)
  declare device?: AccessDeviceModel;

  @BelongsTo(() => AccessCredentialModel)
  declare credential?: AccessCredentialModel;

  @HasOne(() => AccessDecisionModel)
  declare decision?: AccessDecisionModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
