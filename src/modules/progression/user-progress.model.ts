import {
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { UserModel } from "../users/user.model";

/**
 * Instantánea de la progresión de un usuario.
 *
 * Es un modelo de lectura: se reconstruye entero desde los entrenamientos cada
 * vez que se consulta la senda. Se persiste para poder ordenar una clasificación
 * sin recalcular a todo el gimnasio, y para saber qué había la vez anterior y
 * poder decir «has subido de rango».
 */
@Table({
  tableName: "user_progress",
  schema: "progression",
  underscored: true,
  timestamps: true,
})
export class UserProgressModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "usuario_id" })
  declare userId: string;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare points: number;

  @Column({ type: DataType.STRING(60), allowNull: true, field: "level_code" })
  declare levelCode: string | null;

  @Default(0)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: "current_streak_days",
  })
  declare currentStreakDays: number;

  @Default(0)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: "longest_streak_days",
  })
  declare longestStreakDays: number;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: "last_session_on" })
  declare lastSessionOn: string | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: "total_sessions" })
  declare totalSessions: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: "total_sets" })
  declare totalSets: number;

  @Default(0)
  @Column({
    type: DataType.DECIMAL(14, 2),
    allowNull: false,
    field: "total_volume_kg",
  })
  declare totalVolumeKg: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: "recomputed_at" })
  declare recomputedAt: Date;

  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
