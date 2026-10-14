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

/** Por qué no se hizo una serie o un ejercicio (CHECK `ck_saltada_motivo`). */
export const SKIP_REASONS = [
  'CANSANCIO',
  'PRISA',
  'DOLOR',
  'EQUIPO_OCUPADO',
  'TECNICA',
  'OTRO',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * Serie que la persona decidió no hacer. No es una fila de
 * `series_entrenamiento`: no suma volumen, récords, puntos ni progresión.
 */
@Table({ tableName: 'series_saltadas', underscored: true, timestamps: true })
export class WorkoutSkippedSetModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => WorkoutSessionExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'sesion_ejercicio_id' })
  declare sessionExerciseId: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'numero_serie' })
  declare setNumber: number;

  @Column({ type: DataType.STRING(16), allowNull: false, field: 'motivo' })
  declare reason: SkipReason;

  @Column({ type: DataType.STRING(280), allowNull: true, field: 'nota' })
  declare note: string | null;

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
