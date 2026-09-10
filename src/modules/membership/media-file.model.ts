import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";

@Table({
  tableName: "files",
  schema: "media",
  underscored: true,
  timestamps: true,
})
export class MediaFileModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, field: "public_id" })
  declare publicId: string;
  /**
   * Gimnasio propietario. Nulo = compartido: el material importado de
   * catálogos externos de ejercicios no es de nadie en particular.
   */
  @Column({ type: DataType.STRING(60), allowNull: true, field: "tenant_id" })
  declare tenantId: string | null;

  @Column(DataType.STRING(120)) declare code: string;
  @Column(DataType.STRING(180)) declare name: string;
  @Column({ type: DataType.STRING(30), field: "file_type" })
  declare fileType: string;
  @Column({ type: DataType.STRING(100), field: "mime_type" })
  declare mimeType: string;
  @Column({ type: DataType.STRING(30), field: "source_type" })
  declare sourceType: string;
  @Column({ type: DataType.STRING(120), field: "source_name" })
  declare sourceName: string;
  @Column({ type: DataType.TEXT, field: "source_url" })
  declare sourceUrl: string;
  @Column({ type: DataType.TEXT, field: "storage_url" }) declare storageUrl:
    | string
    | null;
  @Column({ type: DataType.STRING(300), field: "alt_text" })
  declare altText: string;
  @Column(DataType.INTEGER) declare width: number | null;
  @Column(DataType.INTEGER) declare height: number | null;
  @Column(DataType.STRING(160)) declare license: string;
  @Column(DataType.STRING(500)) declare attribution: string;
  @Column(DataType.STRING(20)) declare status: string;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
