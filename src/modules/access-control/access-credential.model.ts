import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { CredentialStatus, CredentialType } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { AccessDeviceEventModel } from './access-device-event.model';

@Table({ tableName: 'credentials', schema: 'access_control', underscored: true, timestamps: true })
export class AccessCredentialModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'credential_type' })
  declare credentialType: CredentialType;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare provider: string;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'pin_hash' })
  declare pinHash: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'external_reference' })
  declare externalReference: string | null;

  @Default(CredentialStatus.ACTIVE)
  @Column({ type: DataType.STRING(30), allowNull: false })
  declare status: CredentialStatus;

  @Column({ type: DataType.STRING(80), allowNull: true, field: 'consent_version' })
  declare consentVersion: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'consent_recorded_at' })
  declare consentRecordedAt: Date | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'enrolled_at' })
  declare enrolledAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_verified_at' })
  declare lastVerifiedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'revoked_at' })
  declare revokedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'revocation_reason' })
  declare revocationReason: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @HasMany(() => AccessDeviceEventModel)
  declare deviceEvents?: AccessDeviceEventModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
