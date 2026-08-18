import {
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { ExerciseModel } from "../exercise.model";

@Table({
  tableName: "exercise_ratings",
  schema: "training",
  underscored: true,
  timestamps: false,
})
export class ExerciseRatingModel extends Model {
  @PrimaryKey
  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "ejercicio_id" })
  declare exerciseId: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: "recommended_stars" })
  declare recommendedStars: number;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: "fun_stars" })
  declare funStars: number;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare factors: Record<string, unknown>;

  @Column({ type: DataType.DATE, allowNull: false, field: "computed_at" })
  declare computedAt: Date;

  @Column({ type: DataType.DATE, allowNull: false, field: "updated_at" })
  declare updatedAt: Date;
}
