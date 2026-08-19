import {
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { UserModel } from '../users/user.model';

/**
 * Un PIN de recuperación, guardado como se guarda una credencial.
 *
 * El código en claro sólo existe dos veces: en la memoria del proceso el
 * instante que tarda en enviarse, y en el buzón de quien lo pidió. Aquí vive su
 * hash, por la misma razón por la que no se guardan contraseñas: seis cifras
 * bastan para entrar en una cuenta, y quien lea esta tabla no debe poder
 * hacerlo.
 */
@Table({
  tableName: 'password_reset_tokens',
  underscored: true,
  timestamps: true,
})
export class PasswordResetTokenModel extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare usuarioId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'pin_hash' })
  declare pinHash: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'expira_en' })
  declare expiraEn: Date;

  /** Sellado al usarse. Un token gastado no se borra: su uso es un hecho. */
  @Column({ type: DataType.DATE, allowNull: true, field: 'consumido_en' })
  declare consumidoEn: Date | null;

  /** Intentos fallidos. Al llegar al tope, el PIN se quema. */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare intentos: number;

  @Column({ type: DataType.STRING, allowNull: true, field: 'solicitado_desde_ip' })
  declare solicitadoDesdeIp: string | null;
}
