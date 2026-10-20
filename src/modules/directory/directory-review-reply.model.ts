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
import { DirectoryReviewModel } from './directory-review.model';

@Table({
  tableName: 'review_replies',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class DirectoryReviewReplyModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => DirectoryReviewModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'review_id' })
  declare reviewId: string;

  @BelongsTo(() => DirectoryReviewModel)
  declare review?: DirectoryReviewModel;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'author_id' })
  declare authorId: string;

  @BelongsTo(() => UserModel)
  declare author?: UserModel;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'reply_text' })
  declare replyText: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
