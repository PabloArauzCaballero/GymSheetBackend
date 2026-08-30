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

@Table({ tableName: 'password_reset_tokens', schema: 'auth', underscored: true, timestamps: true })
export class PasswordResetTokenModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  // Not unique: this hashes a 6-digit PIN, and two different users' codes can
  // land on the same digits by chance. Rows are looked up by `userId`.
  @Column({ type: DataType.STRING(64), allowNull: false, field: 'token_hash' })
  declare tokenHash: string;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare attempts: number;

  @Column({ type: DataType.DATE, allowNull: false, field: 'expires_at' })
  declare expiresAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'used_at' })
  declare usedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
