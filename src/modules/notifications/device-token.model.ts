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

export enum DevicePlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  /** Navegador suscrito vía Push API + VAPID (RFC 8291/8292). Ver ADR-0011. */
  WEB = 'WEB',
}

/** Las que entrega Expo, que cifra por su cuenta y no necesita claves nuestras. */
export const EXPO_PLATFORMS = [DevicePlatform.ANDROID, DevicePlatform.IOS] as const;

@Table({ tableName: 'device_tokens', schema: 'notifications', underscored: true, timestamps: true })
export class DeviceTokenModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare platform: DevicePlatform;

  /**
   * Cadena opaca que identifica el destino: un `ExponentPushToken[...]` en
   * ANDROID/IOS y la URL del `endpoint` de la suscripción en WEB. Es el UNIQUE
   * de la tabla porque una fila es un destino, venga del transporte que venga.
   */
  @Column({ type: DataType.STRING(500), allowNull: false, unique: true, field: 'push_token' })
  declare pushToken: string;

  /**
   * Claves de cifrado de la suscripción del navegador (RFC 8291). Sólo existen
   * —y un CHECK lo exige— cuando `platform = WEB`: Expo no las necesita.
   */
  @Column({ type: DataType.STRING(200), allowNull: true })
  declare p256dh: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare auth: string | null;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare active: boolean;

  @Column({ type: DataType.DATE, allowNull: false, field: 'last_seen_at' })
  declare lastSeenAt: Date;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
