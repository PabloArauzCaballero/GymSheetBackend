import {
  Column,
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
 * Días de la semana que un usuario declara como descanso planificado.
 *
 * ISO 8601: 1 = lunes ... 7 = domingo, el mismo criterio que ya usa
 * `EXTRACT(ISODOW ...)` en `progression.repository.ts` para `weekend_sessions`.
 * Una fila por usuario: la preferencia es "estos días, siempre", no un
 * calendario de excepciones puntuales.
 */
@Table({
  tableName: "rest_day_preferences",
  schema: "progression",
  underscored: true,
  timestamps: true,
  createdAt: false,
})
export class RestDayPreferenceModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "usuario_id" })
  declare userId: string;

  @Default([])
  @Column({ type: DataType.ARRAY(DataType.SMALLINT), allowNull: false })
  declare weekdays: number[];

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
