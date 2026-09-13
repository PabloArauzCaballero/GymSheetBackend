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
import { DevicePlatform } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';

/**
 * Un dispositivo que puede recibir push, identificado por el token que Expo
 * emite para él.
 *
 * El token no se borra al darlo de baja: se marca `revokedAt`. Un token
 * revocado sigue siendo la prueba de que ese dispositivo existió, y cuando
 * Expo responde `DeviceNotRegistered` conviene saber que ya lo habíamos
 * retirado en vez de volver a insertarlo en el siguiente arranque de la app.
 */
@Table({
  tableName: 'device_tokens',
  schema: 'notifications',
  underscored: true,
  timestamps: true,
})
export class DeviceTokenModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
    unique: true,
    field: 'expo_push_token',
  })
  declare expoPushToken: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare platform: DevicePlatform;

  @Column({ type: DataType.DATE, allowNull: true, field: 'revoked_at' })
  declare revokedAt: Date | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'last_registered_at' })
  declare lastRegisteredAt: Date;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
