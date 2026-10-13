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

export type ReelStatus = "READY" | "PROCESSING" | "FAILED";

/** Persisted reel media and publication state; visibility/removal timestamps remain separate. */
@Table({
  tableName: "reels",
  schema: "social",
  underscored: true,
  timestamps: false,
})
export class ReelModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Column({
    type: DataType.UUID,
    allowNull: true,
    field: "processing_request_id",
  })
  declare processingRequestId: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    field: "processing_content_sha256",
  })
  declare processingContentSha256: string | null;

  @Default(0)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: "processing_attempt_count",
  })
  declare processingAttemptCount: number;

  @Column({ type: DataType.STRING(60), allowNull: false, field: "tenant_id" })
  declare tenantId: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    field: "storage_provider",
  })
  declare storageProvider: MediaStorageProviderName;

  @Column({ type: DataType.TEXT, allowNull: false, field: "storage_key" })
  declare storageKey: string;

  @Column({ type: DataType.STRING(40), allowNull: false, field: "mime_type" })
  declare mimeType: "video/mp4" | "video/quicktime";

  /** PostgreSQL NUMERIC is represented as a string to preserve its 3-decimal precision. */
  @Column({
    type: DataType.DECIMAL(6, 3),
    allowNull: false,
    field: "duration_seconds",
  })
  declare durationSeconds: string;

  @Default("READY")
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare status: ReelStatus;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  /** Moderation hides the reel without changing its processing state. */
  @Column({ type: DataType.DATE, allowNull: true, field: "hidden_at" })
  declare hiddenAt: Date | null;

  /** Owner or retention deletion is distinct from moderation hiding. */
  @Column({ type: DataType.DATE, allowNull: true, field: "deleted_at" })
  declare deletedAt: Date | null;
}
