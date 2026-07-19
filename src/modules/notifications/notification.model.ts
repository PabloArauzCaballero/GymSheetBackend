import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { NotificationChannel, NotificationStatus } from '../../common/enums/domain.enums';
import { MembershipModel } from '../membership/membership.model';
import { UserModel } from '../users/user.model';
import { DeliveryAttemptModel } from './delivery-attempt.model';

@Table({ tableName: 'messages', schema: 'notifications', underscored: true, timestamps: true })
export class NotificationModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'recipient_user_id' })
  declare recipientUserId: string;

  @ForeignKey(() => MembershipModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'membership_id' })
  declare membershipId: string | null;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare channel: NotificationChannel;

  @Column({ type: DataType.STRING(240), allowNull: true })
  declare subject: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare body: string;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'days_remaining' })
  declare daysRemaining: number | null;

  @Column({ type: DataType.STRING(240), allowNull: false, unique: true, field: 'deduplication_key' })
  declare deduplicationKey: string;

  @Default(NotificationStatus.PENDING)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: NotificationStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'read_at' })
  declare readAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'sent_at' })
  declare sentAt: Date | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare recipient?: UserModel;

  @BelongsTo(() => MembershipModel)
  declare membership?: MembershipModel | null;

  @HasMany(() => DeliveryAttemptModel)
  declare deliveryAttempts?: DeliveryAttemptModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
