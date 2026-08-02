import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import {
  RoutineStatus,
  RoutineVisibility,
  TrainingGoal,
} from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { RoutineExerciseModel } from './routine-exercise.model';

/**
 * A reusable training plan (rutina). Owned by the user that created it — a coach
 * building plans for clients, or a client building their own. Visibility controls
 * whether it is private, shared with assignees, or a public template.
 */
@Table({
  tableName: 'routines',
  schema: 'training',
  underscored: true,
  timestamps: true,
})
export class RoutineModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(160), allowNull: false, field: 'nombre' })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'descripcion' })
  declare description: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'created_by_user_id' })
  declare createdByUserId: string;

  @Default(RoutineVisibility.PRIVATE)
  @Column({
    type: DataType.ENUM(...Object.values(RoutineVisibility)),
    allowNull: false,
    field: 'visibilidad',
  })
  declare visibility: RoutineVisibility;

  @Column({
    type: DataType.ENUM(...Object.values(TrainingGoal)),
    allowNull: true,
    field: 'objetivo',
  })
  declare goal: TrainingGoal | null;

  @Default(RoutineStatus.ACTIVE)
  @Column({
    type: DataType.ENUM(...Object.values(RoutineStatus)),
    allowNull: false,
    field: 'estado',
  })
  declare status: RoutineStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'metadata' })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare createdBy?: UserModel;

  @HasMany(() => RoutineExerciseModel)
  declare exercises?: RoutineExerciseModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
