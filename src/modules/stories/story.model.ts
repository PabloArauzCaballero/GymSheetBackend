import { Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { MediaStorageProviderName } from "../media/media-storage.port";
import { UserModel } from "../users/user.model";

export type StoryMediaType = "image" | "video";

/** Foto o video efímero, visible 24h. Independiente de `profile.photos` (galería permanente). */
@Table({ tableName: "stories", schema: "profile", underscored: true, timestamps: false })
export class StoryModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.STRING(60), allowNull: false, field: "tenant_id" })
  declare tenantId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: "media_url" })
  declare mediaUrl: string;

  @Column({ type: DataType.STRING(20), allowNull: false, field: "storage_provider" })
  declare storageProvider: MediaStorageProviderName;

  @Column({ type: DataType.TEXT, allowNull: false, field: "storage_key" })
  declare storageKey: string;

  @Column({ type: DataType.STRING(10), allowNull: false, field: "media_type" })
  declare mediaType: StoryMediaType;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false, field: "expires_at" })
  declare expiresAt: Date;
}
