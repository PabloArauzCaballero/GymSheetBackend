import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  HasOne,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import { DirectoryEntityModel } from './directory-entity.model';
import { DirectoryReviewHelpfulModel } from './directory-review-helpful.model';
import { DirectoryReviewReplyModel } from './directory-review-reply.model';

export type ReviewStatus = 'PUBLISHED' | 'FLAGGED' | 'HIDDEN' | 'DELETED';

@Table({
  tableName: 'reviews',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class DirectoryReviewModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => DirectoryEntityModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'entity_id' })
  declare entityId: string;

  @BelongsTo(() => DirectoryEntityModel)
  declare entity?: DirectoryEntityModel;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare rating: number;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare title: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare body: string;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_verified_athlete' })
  declare isVerifiedAthlete: boolean;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'experience_date' })
  declare experienceDate: string | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'helpful_count' })
  declare helpfulCount: number;

  @Default('PUBLISHED')
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: ReviewStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'edited_at' })
  declare editedAt: Date | null;

  @HasOne(() => DirectoryReviewReplyModel)
  declare reply?: DirectoryReviewReplyModel | null;

  @HasMany(() => DirectoryReviewHelpfulModel)
  declare helpfulVotes?: DirectoryReviewHelpfulModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
