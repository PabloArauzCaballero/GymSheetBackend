import {
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import {
  ModerationReasonValue,
  ModerationTargetKindValue,
  StrikeKindValue,
} from './moderation.policy';

/**
 * Una falta en el historial de alguien.
 *
 * Es lo que hace subir la escalera, y por eso caduca (`expiresAt`): un
 * historial que no olvida convierte la primera falta de una persona en una
 * condena perpetua, y la escalera dejaría de medir «cómo se está comportando»
 * para medir «cuánto tiempo lleva registrado».
 *
 * Sin `updatedAt`: una sanción emitida no se edita. Si estuvo mal, se revoca
 * borrándola y queda el rastro en `admin.audit_log`.
 */
@Table({
  tableName: 'user_strikes',
  schema: 'moderation',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class UserStrikeModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(60), allowNull: false, field: 'tenant_id' })
  declare tenantId: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare kind: StrikeKindValue;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare reason: ModerationReasonValue;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare note: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true, field: 'target_kind' })
  declare targetKind: ModerationTargetKindValue | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'target_id' })
  declare targetId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'issued_by_user_id' })
  declare issuedByUserId: string | null;

  /** Fin de la suspensión que produjo esta falta. Nulo en advertencia y en expulsión. */
  @Column({ type: DataType.DATE, allowNull: true, field: 'suspended_until' })
  declare suspendedUntil: Date | null;

  /** Cuándo deja de contar para la escalera. */
  @Column({ type: DataType.DATE, allowNull: false, field: 'expires_at' })
  declare expiresAt: Date;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
