import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { ExerciseModel } from "../exercise.model";
import { MuscleModel } from "./muscle.model";

export type ExerciseMuscleRole = "PRIMARY" | "SECONDARY" | "STABILIZER";

@Table({
  tableName: "exercise_muscles",
  schema: "training",
  underscored: true,
  timestamps: false,
})
export class ExerciseMuscleModel extends Model {
  @PrimaryKey
  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "ejercicio_id" })
  declare exerciseId: string;

  @PrimaryKey
  @ForeignKey(() => MuscleModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "muscle_id" })
  declare muscleId: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare role: ExerciseMuscleRole;

  @BelongsTo(() => MuscleModel)
  declare muscle?: MuscleModel;

  @BelongsTo(() => ExerciseModel)
  declare exercise?: ExerciseModel;
}
