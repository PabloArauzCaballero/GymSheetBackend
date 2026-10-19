import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import { DirectoryReviewModel } from './directory-review.model';

@Table({
  tableName: 'review_helpful_votes',
  schema: 'directory',
  underscored: true,
  timestamps: false,
})
export class DirectoryReviewHelpfulModel extends Model {
  @PrimaryKey
  @ForeignKey(() => DirectoryReviewModel)
  @Column({ type: DataType.UUID, field: 'review_id' })
  declare reviewId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: 'user_id' })
  declare userId: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
