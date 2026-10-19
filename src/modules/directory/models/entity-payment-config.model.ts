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

  @Column({ type: DataType.STRING(50), allowNull: false, field: 'tax_id' })
  declare taxId: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'account_number' })
  declare accountNumber: string;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'alias_or_phone' })
  declare aliasOrPhone: string | null;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'qr_image_url' })
  declare qrImageUrl: string;

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
