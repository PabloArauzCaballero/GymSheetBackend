import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { ProgressionBadgeModel } from "./progression-badge.model";

/**
 * Insignia conseguida.
 *
 * Es el único dato de la progresión que no se puede recalcular: si mañana el
 * gimnasio sube el umbral de una insignia, quien ya la tenía la conserva, y la
 * fecha en que la ganó no está en ninguna otra parte.
 */
@Table({
  tableName: "user_badges",
  schema: "progression",
  underscored: true,
  timestamps: false,
})
export class UserBadgeModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "usuario_id" })
  declare userId: string;

  @PrimaryKey
  @ForeignKey(() => ProgressionBadgeModel)
  @Column({ type: DataType.UUID, field: "badge_id" })
  declare badgeId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: "awarded_at" })
  declare awardedAt: Date;

  /** Valor de la métrica en el momento de conseguirla. */
  @Default(0)
  @Column({
    type: DataType.DECIMAL(12, 2),
    allowNull: false,
    field: "progress_value",
  })
  declare progressValue: string;

  /** Falso hasta que la pantalla la ha mostrado como novedad. */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare seen: boolean;

  @BelongsTo(() => ProgressionBadgeModel)
  declare badge?: ProgressionBadgeModel;
}
