import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { UserModel } from "../users/user.model";

export const DISCOVERY_PASS_ORIGIN = { SWIPE: "SWIPE", REPORT: "REPORT" } as const;
export type DiscoveryPassOrigin = (typeof DISCOVERY_PASS_ORIGIN)[keyof typeof DISCOVERY_PASS_ORIGIN];

/**
 * Descarte de la baraja de descubrimiento: `viewerId` no quiere volver a ver a
 * `targetId`.
 *
 * No es simétrico y no tiene estado: existe o no existe. Por eso la clave
 * primaria es la propia pareja y la tabla no lleva `id` ni `updated_at` — un
 * pass repetido es el mismo pass, no uno nuevo.
 */
@Table({
  tableName: "discovery_passes",
  schema: "social",
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class DiscoveryPassModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "viewer_id" })
  declare viewerId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "target_id" })
  declare targetId: string;

  /**
   * SWIPE: the viewer passed in the deck. REPORT: implied by a report; it is
   * never shown to the target (passes-received) so a report stays anonymous.
   */
  @Column({ type: DataType.STRING(10), allowNull: false, defaultValue: DISCOVERY_PASS_ORIGIN.SWIPE })
  declare origin: DiscoveryPassOrigin;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
