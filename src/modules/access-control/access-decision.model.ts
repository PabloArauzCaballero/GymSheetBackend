import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { AccessDecisionOutcome, AccessDecisionReason } from '../../common/enums/domain.enums';
import { MembershipModel } from '../membership/membership.model';
import { StaffProfileModel } from '../membership/staff-profile.model';
import { UserModel } from '../users/user.model';
import { AccessDeviceEventModel } from './access-device-event.model';

@Table({ tableName: 'decisions', schema: 'access_control', underscored: true, timestamps: true })
export class AccessDecisionModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => AccessDeviceEventModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'device_event_id' })
  declare deviceEventId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare outcome: AccessDecisionOutcome;

  @Column({ type: DataType.STRING(60), allowNull: false, field: 'reason_code' })
  declare reasonCode: AccessDecisionReason;

  @ForeignKey(() => MembershipModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'membership_id' })
  declare membershipId: string | null;

  @ForeignKey(() => StaffProfileModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'staff_profile_id' })
  declare staffProfileId: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'days_remaining' })
  declare daysRemaining: number | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'decided_at' })
  declare decidedAt: Date;

  @Column({ type: DataType.STRING(80), allowNull: false, field: 'policy_version' })
  declare policyVersion: string;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => AccessDeviceEventModel)
  declare deviceEvent?: AccessDeviceEventModel;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @BelongsTo(() => MembershipModel)
  declare membership?: MembershipModel | null;

  @BelongsTo(() => StaffProfileModel)
  declare staffProfile?: StaffProfileModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
