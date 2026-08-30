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
import { UserModel } from '../users/user.model';
import { AdminPermissionModel } from './admin-permission.model';

/** Grants one permission key from the catalog to one staff user; expirable and audited. */
@Table({ tableName: 'user_permissions', schema: 'admin', underscored: true, timestamps: true })
export class AdminUserPermissionModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @ForeignKey(() => AdminPermissionModel)
  @Column({ type: DataType.STRING(80), allowNull: false, field: 'permission_key' })
  declare permissionKey: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'granted_by_user_id' })
  declare grantedByUserId: string | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'granted_at' })
  declare grantedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'expires_at' })
  declare expiresAt: Date | null;

  @BelongsTo(() => UserModel, 'userId')
  declare user?: UserModel;

  @BelongsTo(() => AdminPermissionModel)
  declare permission?: AdminPermissionModel;

  @BelongsTo(() => UserModel, 'grantedByUserId')
  declare grantedByUser?: UserModel | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
