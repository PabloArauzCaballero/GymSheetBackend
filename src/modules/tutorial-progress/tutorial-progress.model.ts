import { Column, DataType, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";

/** Progreso de una persona en un tutorial. La clave es (usuario, tutorial): un solo registro por par. */
@Table({ tableName: "tutorial_progress", schema: "profile", underscored: true, timestamps: false })
export class TutorialProgressModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @PrimaryKey
  @Column({ type: DataType.STRING(100), allowNull: false, field: "tutorial_id" })
  declare tutorialId: string;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare status: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare version: string;

  @Column({ type: DataType.STRING(100), allowNull: true, field: "current_step_id" })
  declare currentStepId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "started_at" })
  declare startedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "completed_at" })
  declare completedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: false, field: "last_interaction_at" })
  declare lastInteractionAt: Date;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: "repeat_count" })
  declare repeatCount: number;
}
