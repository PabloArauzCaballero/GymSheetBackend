import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { UserModel } from '../users/user.model';

/**
 * Petición de activación para quien pagó fuera de la app.
 *
 * El token vive hasheado, como cualquier credencial: el enlace que viaja por
 * WhatsApp basta para activar una cuenta, así que quien lea esta tabla no debe
 * poder hacerlo.
 *
 * `consumidoPorUserId` no es contabilidad decorativa: cuando la caja no cuadre,
 * la pregunta será quién activó qué y cuándo, y ésta es la única fila que puede
 * responderla.
 */
@Table({
  tableName: 'membership_activation_requests',
  underscored: true,
  timestamps: true,
})
export class MembershipActivationRequestModel extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare usuarioId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'token_hash' })
  declare tokenHash: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'expira_en' })
  declare expiraEn: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'consumido_en' })
  declare consumidoEn: Date | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'consumido_por_user_id' })
  declare consumidoPorUserId: string | null;

  /** Lo que la persona escribió al pedirlo, si escribió algo. */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare nota: string | null;
}
