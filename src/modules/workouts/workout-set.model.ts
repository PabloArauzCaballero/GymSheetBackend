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

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'repeticiones' })
  declare repetitions: number | null;

  @Column({ type: DataType.DECIMAL(7, 2), allowNull: true, field: 'peso_kg' })
  declare weightKg: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'rir' })
  declare rir: number | null;

  @Default('FUERZA')
  @Column({ type: DataType.STRING(8), allowNull: false, field: 'tipo_serie' })
  declare type: 'FUERZA' | 'CARDIO';

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'duracion_seg' })
  declare durationSeconds: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'distancia_m' })
  declare distanceM: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'fc_media' })
  declare avgHeartRate: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'rpe' })
  declare rpe: number | null;

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
