import { Column, CreatedAt, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'exercise_likes', schema: 'community', underscored: true, timestamps: true, updatedAt: false })
export class ExerciseLikeModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'ejercicio_id' })
  declare exerciseId: string;

  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'usuario_id' })
  declare userId: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
