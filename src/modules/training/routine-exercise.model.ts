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
import { ExerciseModel } from '../exercises/exercise.model';
import { RoutineModel } from './routine.model';

/**
 * A prescribed exercise inside a routine, with target volume (series, rep range,
 * load, RIR and rest). Targets are guidance the live session renders; the athlete
 * records the actual sets against a workout session.
 */
@Table({
  tableName: 'routine_exercises',
  schema: 'training',
  underscored: true,
  timestamps: true,
})
export class RoutineExerciseModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => RoutineModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'routine_id' })
  declare routineId: string;

  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_id' })
  declare exerciseId: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'orden' })
  declare order: number;

  @Default(3)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'series_objetivo' })
  declare targetSets: number;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'reps_min' })
  declare repsMin: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'reps_max' })
  declare repsMax: number | null;

  @Column({ type: DataType.DECIMAL(7, 2), allowNull: true, field: 'peso_objetivo_kg' })
  declare targetWeightKg: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'rir_objetivo' })
  declare targetRir: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'descanso_seg' })
  declare restSeconds: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'nota' })
  declare note: string | null;

  @BelongsTo(() => RoutineModel)
  declare routine?: RoutineModel;

  @BelongsTo(() => ExerciseModel)
  declare exercise?: ExerciseModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
