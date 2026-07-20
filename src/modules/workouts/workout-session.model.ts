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
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';

@Table({ tableName: 'sesiones_entrenamiento', underscored: true, timestamps: true })
export class WorkoutSessionModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare userId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_inicio' })
  declare startedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'fecha_fin' })
  declare finishedAt: Date | null;

  @Default(WorkoutSessionStatus.IN_PROGRESS)
  @Column({
    type: DataType.ENUM(...Object.values(WorkoutSessionStatus)),
    allowNull: false,
    field: 'estado',
  })
  declare status: WorkoutSessionStatus;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'observacion' })
  declare observation: string | null;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @HasMany(() => WorkoutSessionExerciseModel)
  declare sessionExercises?: WorkoutSessionExerciseModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
