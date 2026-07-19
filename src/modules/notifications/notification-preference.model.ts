import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';

@Table({ tableName: 'preferences', schema: 'notifications', underscored: true, timestamps: true })
export class NotificationPreferenceModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'user_id' })
  declare userId: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'membership_expiry_enabled' })
  declare membershipExpiryEnabled: boolean;

  @Default(NotificationChannel.IN_APP)
  @Column({ type: DataType.STRING(30), allowNull: false, field: 'preferred_channel' })
  declare preferredChannel: NotificationChannel.IN_APP | NotificationChannel.HTTP_GATEWAY;

  @Column({ type: DataType.DATE, allowNull: true, field: 'external_delivery_consent_at' })
  declare externalDeliveryConsentAt: Date | null;

  @Column({ type: DataType.STRING(80), allowNull: true, field: 'consent_version' })
  declare consentVersion: string | null;

  @Column({ type: DataType.TIME, allowNull: true, field: 'quiet_hours_start' })
  declare quietHoursStart: string | null;

  @Column({ type: DataType.TIME, allowNull: true, field: 'quiet_hours_end' })
  declare quietHoursEnd: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
