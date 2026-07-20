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
import {
  ExerciseMediaProvider,
  ExerciseMediaStatus,
  ExerciseMediaType,
} from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { ExerciseModel } from './exercise.model';

/**
 * Metadata for an exercise image, animation, or video.
 * Binary data remains in an object-storage/media provider; PostgreSQL stores
 * stable references, dimensions, integrity metadata, accessibility text, and
 * licensing information.
 */
@Table({
  tableName: 'exercise_media',
  schema: 'training',
  underscored: true,
  timestamps: true,
})
export class ExerciseMediaModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_id' })
  declare exerciseId: string;

  @Column({ type: DataType.STRING(20), allowNull: false, field: 'media_type' })
  declare mediaType: ExerciseMediaType;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare provider: ExerciseMediaProvider;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'external_id' })
  declare externalId: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare url: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'thumbnail_url' })
  declare thumbnailUrl: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'mime_type' })
  declare mimeType: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare width: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare height: number | null;

  @Column({ type: DataType.STRING(64), allowNull: true, field: 'checksum_sha256' })
  declare checksumSha256: string | null;

  @Column({ type: DataType.STRING(500), allowNull: false, field: 'alt_text' })
  declare altText: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare attribution: string | null;

  @Column({ type: DataType.STRING(160), allowNull: true })
  declare license: string | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_primary' })
  declare isPrimary: boolean;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_order' })
  declare sortOrder: number;

  @Default(ExerciseMediaStatus.ACTIVE)
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: ExerciseMediaStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'created_by_usuario_id' })
  declare createdByUserId: string | null;

  @BelongsTo(() => ExerciseModel)
  declare exercise?: ExerciseModel;

  @BelongsTo(() => UserModel)
  declare createdByUser?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
