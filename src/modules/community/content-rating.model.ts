import { Column, CreatedAt, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

export type CommunityTargetKind = 'ROUTINE' | 'EXERCISE';

@Table({ tableName: 'content_ratings', schema: 'community', underscored: true, timestamps: true })
export class ContentRatingModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(12), field: 'target_kind' })
  declare targetKind: CommunityTargetKind;

  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'target_id' })
  declare targetId: string;

  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'usuario_id' })
  declare userId: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'estrellas' })
  declare stars: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
