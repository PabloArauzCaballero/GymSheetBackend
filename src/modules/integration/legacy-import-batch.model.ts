import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { LegacyImportBatchStatus } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { LegacyImportRecordModel } from './legacy-import-record.model';

@Table({ tableName: 'legacy_import_batches', schema: 'integration', underscored: true, timestamps: true })
export class LegacyImportBatchModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(120), allowNull: false, field: 'source_system' })
  declare sourceSystem: string;

  @Column({ type: DataType.STRING(180), allowNull: false, field: 'external_batch_id' })
  declare externalBatchId: string;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'source_version' })
  declare sourceVersion: string | null;

  @Default(LegacyImportBatchStatus.VALIDATING)
  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: LegacyImportBatchStatus;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'dry_run' })
  declare dryRun: boolean;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'total_records' })
  declare totalRecords: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'valid_records' })
  declare validRecords: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'invalid_records' })
  declare invalidRecords: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'imported_records' })
  declare importedRecords: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'failed_records' })
  declare failedRecords: number;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'started_at' })
  declare startedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'completed_at' })
  declare completedAt: Date | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'requested_by_user_id' })
  declare requestedByUserId: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare requestedByUser?: UserModel | null;

  @HasMany(() => LegacyImportRecordModel)
  declare records?: LegacyImportRecordModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
