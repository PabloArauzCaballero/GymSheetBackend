import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { NotificationStatus } from '../../common/enums/domain.enums';
import { NotificationModel } from './notification.model';

@Table({ tableName: 'delivery_attempts', schema: 'notifications', underscored: true, timestamps: true })
export class DeliveryAttemptModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => NotificationModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'notification_id' })
  declare notificationId: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'attempt_number' })
  declare attemptNumber: number;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare provider: string;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: NotificationStatus.SENT | NotificationStatus.FAILED;

  @Column({ type: DataType.STRING(240), allowNull: true, field: 'provider_message_id' })
  declare providerMessageId: string | null;

  @Column({ type: DataType.STRING(80), allowNull: true, field: 'response_code' })
  declare responseCode: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'error_code' })
  declare errorCode: string | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'attempted_at' })
  declare attemptedAt: Date;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => NotificationModel)
  declare notification?: NotificationModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
