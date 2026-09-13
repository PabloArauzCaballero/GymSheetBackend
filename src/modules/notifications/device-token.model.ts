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
}

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

  @Column({ type: DataType.STRING(200), allowNull: false, unique: true, field: 'expo_push_token' })
  declare expoPushToken: string;

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
