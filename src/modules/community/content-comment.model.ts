import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { CommunityTargetKind } from './content-rating.model';

export type CommentState = 'VISIBLE' | 'OCULTO_AUTO' | 'OCULTO_MODERACION' | 'BORRADO_AUTOR';

@Table({ tableName: 'content_comments', schema: 'community', underscored: true, timestamps: true })
export class ContentCommentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'target_kind' })
  declare targetKind: CommunityTargetKind;

  @Column({ type: DataType.UUID, allowNull: false, field: 'target_id' })
  declare targetId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'autor_id' })
  declare authorId: string;

  @Column({ type: DataType.UUID, allowNull: true, field: 'respuesta_a' })
  declare replyToId: string | null;

  @Column({ type: DataType.STRING(1000), allowNull: false, field: 'texto' })
  declare text: string;

  @Column({ type: DataType.STRING(10), allowNull: true, field: 'adjunto_tipo' })
  declare attachmentKind: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'adjunto_url' })
  declare attachmentUrl: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'adjunto_mime' })
  declare attachmentMime: string | null;

  @Column({ type: DataType.STRING(200), allowNull: true, field: 'adjunto_nombre' })
  declare attachmentName: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'adjunto_bytes' })
  declare attachmentBytes: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'adjunto_ancho' })
  declare attachmentWidth: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'adjunto_alto' })
  declare attachmentHeight: number | null;

  @Default('VISIBLE')
  @Column({ type: DataType.STRING(20), allowNull: false, field: 'estado' })
  declare status: CommentState;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
