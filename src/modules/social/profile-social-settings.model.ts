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

  /** Social discovery stays off until the account explicitly activates it. */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: "profile_enabled" })
  declare profileEnabled: boolean;

  /** Independent consent to be discoverable across GymSheet tenants. */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: "cross_gym_enabled" })
  declare crossGymEnabled: boolean;

  /** Map exposure is a separate opt-in from profile discovery. */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: "map_enabled" })
  declare mapEnabled: boolean;

  @Column({ type: DataType.DATE, allowNull: true, field: "map_enabled_since" })
  declare mapEnabledSince: Date | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare version: number;

  /**
   * Cuándo abrió por última vez la lista de "quién vio mi perfil".
   *
   * Nulo significa que nunca la abrió, no que no haya nada nuevo: con nulo,
   * todas las visitas cuentan como nuevas. Vive aquí y no en una tabla aparte
   * porque esto es exactamente lo que esta tabla guarda — una fila de ajustes
   * sociales por persona.
   */
  @Column({ type: DataType.DATE, allowNull: true, field: "profile_views_checked_at" })
  declare profileViewsCheckedAt: Date | null;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
