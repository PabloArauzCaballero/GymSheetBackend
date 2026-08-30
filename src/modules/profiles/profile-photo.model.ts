import {
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { MediaStorageProviderName } from "../media/media-storage.port";
import { UserModel } from "../users/user.model";

/** Una foto de la galería de perfil de un usuario. Independiente de la mediateca administrada por el gimnasio. */
@Table({
  tableName: "photos",
  schema: "profile",
  underscored: true,
  timestamps: false,
})
export class ProfilePhotoModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare url: string;

  @Column({ type: DataType.STRING(20), allowNull: false, field: "storage_provider" })
  declare storageProvider: MediaStorageProviderName;

  @Column({ type: DataType.TEXT, allowNull: false, field: "storage_key" })
  declare storageKey: string;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare position: number;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
