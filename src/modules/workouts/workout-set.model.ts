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
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';

@Table({ tableName: 'series_entrenamiento', underscored: true, timestamps: true })
export class WorkoutSetModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => WorkoutSessionExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'sesion_ejercicio_id' })
  declare sessionExerciseId: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'numero_serie' })
  declare setNumber: number;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'repeticiones' })
  declare repetitions: number;

  @Column({ type: DataType.DECIMAL(7, 2), allowNull: false, field: 'peso_kg' })
  declare weightKg: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'rir' })
  declare rir: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'descanso_seg_anterior',
  })
  declare previousRestSeconds: number;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_registro' })
  declare recordedAt: Date;

  @BelongsTo(() => WorkoutSessionExerciseModel)
  declare sessionExercise?: WorkoutSessionExerciseModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
