import {
  BelongsTo,
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
import { RoutineModel } from '../training/routine.model';

export type ExportFormat = 'CSV' | 'EXCEL' | 'PDF';

/**
 * Registro auditable de cada descarga de progreso del sistema de rutinas.
 * Inmutable (timestamps solo `created_at`).
 */
@Table({
  tableName: 'routine_progress_download_audits',
  schema: 'training',
  underscored: true,
  timestamps: false,
})
export class RoutineProgressDownloadAuditModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @ForeignKey(() => RoutineModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'routine_id' })
  declare routineId: string | null;

  @Column({ type: DataType.STRING(10), allowNull: false, field: 'format' })
  declare format: ExportFormat;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'filters' })
  declare filters: Record<string, unknown>;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'file_name' })
  declare fileName: string;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'records_count' })
  declare recordsCount: number;

  @Column({ type: DataType.STRING(60), allowNull: true, field: 'ip' })
  declare ip: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'user_agent' })
  declare userAgent: string | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'created_at' })
  declare createdAt: Date;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @BelongsTo(() => RoutineModel)
  declare routine?: RoutineModel;
}
