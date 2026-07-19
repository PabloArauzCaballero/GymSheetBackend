import {
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
import { UserModel } from '../users/user.model';

@Table({
  tableName: 'domain_events',
  schema: 'integration',
  underscored: true,
  timestamps: true,
})
export class DomainEventModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(160), allowNull: false, field: 'event_name' })
  declare eventName: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'event_version' })
  declare eventVersion: number;

  @Column({ type: DataType.STRING(120), allowNull: false, field: 'aggregate_type' })
  declare aggregateType: string;

  @Column({ type: DataType.UUID, allowNull: true, field: 'aggregate_id' })
  declare aggregateId: string | null;

  @Column({
    type: DataType.STRING(240),
    allowNull: false,
    unique: true,
    field: 'deduplication_key',
  })
  declare deduplicationKey: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'actor_user_id' })
  declare actorUserId: string | null;

  @Column({ type: DataType.STRING(128), allowNull: true, field: 'correlation_id' })
  declare correlationId: string | null;

  @ForeignKey(() => DomainEventModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'causation_event_id' })
  declare causationEventId: string | null;

  @Column({ type: DataType.STRING(128), allowNull: true, field: 'trace_id' })
  declare traceId: string | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'occurred_at' })
  declare occurredAt: Date;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare payload: Record<string, unknown>;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
