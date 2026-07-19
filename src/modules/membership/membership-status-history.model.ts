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
import { MembershipStatus } from '../../common/enums/domain.enums';
import { DomainEventModel } from '../integration/domain-event.model';
import { UserModel } from '../users/user.model';
import { MembershipModel } from './membership.model';

@Table({
  tableName: 'status_history',
  schema: 'membership',
  underscored: true,
  timestamps: true,
})
export class MembershipStatusHistoryModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => MembershipModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'membership_id' })
  declare membershipId: string;

  @Column({ type: DataType.STRING(30), allowNull: true, field: 'from_status' })
  declare fromStatus: MembershipStatus | null;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'to_status' })
  declare toStatus: MembershipStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare reason: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'actor_user_id' })
  declare actorUserId: string | null;

  @ForeignKey(() => DomainEventModel)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    unique: true,
    field: 'domain_event_id',
  })
  declare domainEventId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'occurred_at' })
  declare occurredAt: Date;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => MembershipModel)
  declare membership?: MembershipModel;

  @BelongsTo(() => DomainEventModel)
  declare domainEvent?: DomainEventModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
