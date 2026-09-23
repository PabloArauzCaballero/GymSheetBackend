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
} from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import {
  ModerationReasonValue,
  ModerationResolutionValue,
  ModerationStatusValue,
  ModerationTargetKindValue,
} from './moderation.policy';

/**
 * La queja de UNA persona sobre UNA cosa.
 *
 * Varias filas sobre el mismo `(targetKind, targetId)` son el mismo caso: la
 * cola las agrupa y resolverlas las cierra a la vez. Se guardan separadas
 * porque hay que saber quién se quejó —para avisarle del resultado— y contar
 * denunciantes distintos, que es lo que dispara el auto-ocultado.
 */
@Table({
  tableName: 'reports',
  schema: 'moderation',
  underscored: true,
  timestamps: true,
})
export class ModerationReportModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false, field: 'tenant_id' })
  declare tenantId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'reporter_user_id' })
  declare reporterUserId: string;

  /** Dueño del contenido. Resuelto al reportar, no deducido al leer. */
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'reported_user_id' })
  declare reportedUserId: string;

  @Column({ type: DataType.STRING(20), allowNull: false, field: 'target_kind' })
  declare targetKind: ModerationTargetKindValue;

  @Column({ type: DataType.UUID, allowNull: false, field: 'target_id' })
  declare targetId: string;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare reason: ModerationReasonValue;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare details: string | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: ModerationStatusValue;

  @Column({ type: DataType.STRING(30), allowNull: true })
  declare resolution: ModerationResolutionValue | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'resolution_note' })
  declare resolutionNote: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'resolved_by_user_id' })
  declare resolvedByUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'resolved_at' })
  declare resolvedAt: Date | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'claimed_by_user_id' })
  declare claimedByUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'claimed_at' })
  declare claimedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
