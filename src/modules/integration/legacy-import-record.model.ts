import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { LegacyImportRecordStatus } from '../../common/enums/domain.enums';
import { LegacyImportBatchModel } from './legacy-import-batch.model';

@Table({ tableName: 'legacy_import_records', schema: 'integration', underscored: true, timestamps: true })
export class LegacyImportRecordModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => LegacyImportBatchModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'batch_id' })
  declare batchId: string;

  @Column({ type: DataType.STRING(120), allowNull: false, field: 'source_entity' })
  declare sourceEntity: string;

  @Column({ type: DataType.STRING(200), allowNull: false, field: 'source_record_id' })
  declare sourceRecordId: string;

  @Column({ type: DataType.STRING(64), allowNull: false, field: 'payload_fingerprint' })
  declare payloadFingerprint: string;

  @Column({ type: DataType.JSONB, allowNull: false, field: 'canonical_payload' })
  declare canonicalPayload: Record<string, unknown>;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: LegacyImportRecordStatus;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'target_entity_type' })
  declare targetEntityType: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'target_entity_id' })
  declare targetEntityId: string | null;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false, field: 'error_codes' })
  declare errorCodes: string[];

  @Column({ type: DataType.DATE, allowNull: true, field: 'imported_at' })
  declare importedAt: Date | null;

  @BelongsTo(() => LegacyImportBatchModel)
  declare batch?: LegacyImportBatchModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
