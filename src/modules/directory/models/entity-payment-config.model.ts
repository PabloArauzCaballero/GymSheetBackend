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
import { DirectoryEntityModel } from '../directory-entity.model';

@Table({
  tableName: 'entity_payment_configs',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class EntityPaymentConfigModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => DirectoryEntityModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'entity_id' })
  declare entityId: string;

  @BelongsTo(() => DirectoryEntityModel)
  declare entity?: DirectoryEntityModel;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'bank_name' })
  declare bankName: string;

  @Column({ type: DataType.STRING(180), allowNull: false, field: 'account_holder_name' })
  declare accountHolderName: string;

  /** Legacy: the NIT lives in the KYC since franja 8d (ADR-0024). */
  @Column({ type: DataType.STRING(50), allowNull: true, field: 'tax_id' })
  declare taxId: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'account_number' })
  declare accountNumber: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'alias_or_phone' })
  declare aliasOrPhone: string | null;

  /** Legacy public URL; the QR is a private encrypted file since franja 8d (ADR-0024). */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'qr_image_url' })
  declare qrImageUrl: string | null;

  /** `business/{entityId}/payment/{uuid}.bin`, encrypted; served only to a buyer of an open order. */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'qr_private_key' })
  declare qrPrivateKey: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true, field: 'qr_mime' })
  declare qrMime: string | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'accepts_cash' })
  declare acceptsCash: boolean;

  /** Holder name vs the KYC legal name or representative: WARN flags REPP's post-review, never blocks. */
  @Column({ type: DataType.STRING(7), allowNull: true, field: 'holder_match' })
  declare holderMatch: 'PASS' | 'WARN' | 'UNKNOWN' | null;

  @Column({ type: DataType.DECIMAL(4, 3), allowNull: true, field: 'holder_similarity' })
  declare holderSimilarity: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'qr_payload' })
  declare qrPayload: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare instructions: string | null;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_active' })
  declare isActive: boolean;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
