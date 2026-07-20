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
import { QueueItemStatus } from '../../common/enums/domain.enums';
import { DomainEventModel } from './domain-event.model';

@Table({
  tableName: 'outbox_jobs',
  schema: 'integration',
  underscored: true,
  timestamps: true,
})
export class OutboxJobModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(120), allowNull: false, field: 'queue_name' })
  declare queueName: string;

  @Column({ type: DataType.STRING(160), allowNull: false, field: 'event_type' })
  declare eventType: string;

  @Column({ type: DataType.STRING(120), allowNull: false, field: 'aggregate_type' })
  declare aggregateType: string;

  @Column({ type: DataType.UUID, allowNull: true, field: 'aggregate_id' })
  declare aggregateId: string | null;

  @ForeignKey(() => DomainEventModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'domain_event_id' })
  declare domainEventId: string | null;

  @Column({
    type: DataType.STRING(240),
    allowNull: false,
    unique: true,
    field: 'deduplication_key',
  })
  declare deduplicationKey: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare payload: Record<string, unknown>;

  @Default(QueueItemStatus.PENDING)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: QueueItemStatus;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'attempt_count' })
  declare attemptCount: number;

  @Default(5)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'max_attempts' })
  declare maxAttempts: number;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'available_at' })
  declare availableAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'locked_at' })
  declare lockedAt: Date | null;

  @Column({ type: DataType.STRING(160), allowNull: true, field: 'locked_by' })
  declare lockedBy: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'processed_at' })
  declare processedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'last_error' })
  declare lastError: string | null;

  @Column({ type: DataType.STRING(128), allowNull: true, field: 'trace_id' })
  declare traceId: string | null;

  @BelongsTo(() => DomainEventModel)
  declare domainEvent?: DomainEventModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
