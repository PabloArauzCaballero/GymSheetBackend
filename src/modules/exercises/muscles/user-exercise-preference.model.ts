import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { UserModel } from "../../users/user.model";
import { ExerciseModel } from "../exercise.model";

@Table({
  tableName: "user_exercise_preferences",
  schema: "training",
  underscored: true,
  timestamps: true,
})
export class UserExercisePreferenceModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "usuario_id" })
  declare userId: string;

  @PrimaryKey
  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "ejercicio_id" })
  declare exerciseId: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, field: "is_favorite" })
  declare isFavorite: boolean;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: "personal_rating" })
  declare personalRating: number | null;

  @Column({ type: DataType.STRING(300), allowNull: true })
  declare notes: string | null;

  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
