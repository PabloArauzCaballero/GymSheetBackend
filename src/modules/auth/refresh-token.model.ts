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
import { RefreshTokenRevokedReason } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';

@Table({ tableName: 'refresh_tokens', schema: 'auth', underscored: true, timestamps: true })
export class RefreshTokenModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  /** Shared by every token descended from the same login, so a reuse of an
   * already-rotated token can revoke the whole chain instead of one row. */
  @Column({ type: DataType.UUID, allowNull: false, field: 'family_id' })
  declare familyId: string;

  @Column({ type: DataType.STRING(64), allowNull: false, unique: true, field: 'token_hash' })
  declare tokenHash: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'expires_at' })
  declare expiresAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'revoked_at' })
  declare revokedAt: Date | null;

  @Column({ type: DataType.STRING(20), allowNull: true, field: 'revoked_reason' })
  declare revokedReason: RefreshTokenRevokedReason | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
