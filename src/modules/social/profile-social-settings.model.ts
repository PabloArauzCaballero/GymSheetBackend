import { Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from "sequelize-typescript";
import { SocialStatus } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";

/**
 * Estado social del perfil: abierto a conocer gente / en pareja / soltero-a.
 *
 * `visible` es la única llave de privacidad: si es falso, el dato existe pero
 * nadie más lo ve, ni siquiera una conexión aceptada. Nulo en `socialStatus`
 * es "no lo he dicho", distinto de "prefiero no decirlo" — no hay un tercer
 * valor porque no hace falta uno: la fila sencillamente no existe todavía.
 */
@Table({
  tableName: "profile_settings",
  schema: "social",
  underscored: true,
  timestamps: true,
  createdAt: false,
})
export class ProfileSocialSettingsModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.STRING(20), allowNull: true, field: "social_status" })
  declare socialStatus: SocialStatus | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare visible: boolean;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
