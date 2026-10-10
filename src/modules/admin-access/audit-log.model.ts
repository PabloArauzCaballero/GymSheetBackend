import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * Una acción administrativa ya ocurrida.
 *
 * `timestamps: false` es deliberado: la tabla es de sólo inserción y su única
 * marca temporal es `occurred_at`. Dejar que Sequelize añadiera `updated_at`
 * sugeriría que una fila de auditoría se puede modificar, que es exactamente lo
 * que no debe poder hacerse.
 */
@Table({
  tableName: 'audit_log',
  schema: 'admin',
  underscored: true,
  timestamps: false,
})
export class AdminAuditLogModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'occurred_at' })
  declare occurredAt: Date;

  /** Nulo sólo si la cuenta del actor se borró después; `actorEmail` conserva quién fue. */
  @Column({ type: DataType.UUID, allowNull: true, field: 'actor_user_id' })
  declare actorUserId: string | null;

  @Column({ type: DataType.STRING(180), allowNull: false, field: 'actor_email' })
  declare actorEmail: string;

  @Column({ type: DataType.STRING(40), allowNull: false, field: 'actor_role' })
  declare actorRole: string;

  /** Nulo = acción de plataforma (un `SYSTEM_ADMIN` que no suplanta). */
  @Column({ type: DataType.STRING(60), allowNull: true, field: 'tenant_scope' })
  declare tenantScope: string | null;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare domain: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare action: string;

  @Column({ type: DataType.STRING(60), allowNull: true, field: 'target_kind' })
  declare targetKind: string | null;

  @Column({ type: DataType.STRING(200), allowNull: true, field: 'target_id' })
  declare targetId: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @Column({ type: DataType.INET, allowNull: true })
  declare ip: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'user_agent' })
  declare userAgent: string | null;
}
