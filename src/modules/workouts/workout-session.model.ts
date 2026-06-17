import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
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
  declare usuarioId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_inicio' })
  declare fechaInicio: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'fecha_fin' })
  declare fechaFin: Date | null;

  @Default(WorkoutSessionStatus.EN_PROGRESO)
  @Column({ type: DataType.ENUM(...Object.values(WorkoutSessionStatus)), allowNull: false })
  declare estado: WorkoutSessionStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare observacion: string | null;

  @BelongsTo(() => UserModel)
  declare usuario?: UserModel;

  @HasMany(() => WorkoutSessionExerciseModel)
  declare ejercicios?: WorkoutSessionExerciseModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
