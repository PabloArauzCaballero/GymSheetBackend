import {
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
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';

/**
 * Un día de la rutina. `weekday` es ISO (1 = lunes); NULL significa «cualquier
 * día» y es lo que reciben las rutinas planas creadas antes de las rutinas v2.
 */
@Table({ tableName: 'routine_days', schema: 'training', underscored: true, timestamps: true })
export class RoutineDayModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => RoutineModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'routine_id' })
  declare routineId: string;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'dia_semana' })
  declare weekday: number | null;

  @Column({ type: DataType.STRING(60), allowNull: true, field: 'nombre' })
  declare name: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'orden' })
  declare order: number;

  @HasMany(() => RoutineExerciseModel, 'routineDayId')
  declare exercises?: RoutineExerciseModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
