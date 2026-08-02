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
  UpdatedAt,
} from 'sequelize-typescript';
import { RoutineAssignmentStatus } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { RoutineModel } from './routine.model';

/**
 * Links a routine to a client (coach → athlete) with optional scheduling.
 * `scheduledFor` programs a single date; `weekdays` (0=Sun..6=Sat) programs a
 * recurring weekly plan. The backend remains the authority; clients only see
 * plans assigned to them.
 */
@Table({
  tableName: 'routine_assignments',
  schema: 'training',
  underscored: true,
  timestamps: true,
})
export class RoutineAssignmentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => RoutineModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'routine_id' })
  declare routineId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'cliente_user_id' })
  declare clientUserId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'asignado_por_user_id' })
  declare assignedByUserId: string;

  @Default(RoutineAssignmentStatus.ACTIVE)
  @Column({
    type: DataType.ENUM(...Object.values(RoutineAssignmentStatus)),
    allowNull: false,
    field: 'estado',
  })
  declare status: RoutineAssignmentStatus;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'fecha_programada' })
  declare scheduledFor: string | null;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false, field: 'dias_semana' })
  declare weekdays: number[];

  @Column({ type: DataType.TEXT, allowNull: true, field: 'nota' })
  declare note: string | null;

  @BelongsTo(() => RoutineModel)
  declare routine?: RoutineModel;

  @BelongsTo(() => UserModel, 'clientUserId')
  declare client?: UserModel;

  @BelongsTo(() => UserModel, 'assignedByUserId')
  declare assignedBy?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
