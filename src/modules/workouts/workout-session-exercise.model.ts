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
import { ExerciseModel } from '../exercises/exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';

@Table({ tableName: 'sesiones_ejercicios', underscored: true, timestamps: true })
export class WorkoutSessionExerciseModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => WorkoutSessionModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'sesion_id' })
  declare sessionId: string;

  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_id' })
  declare exerciseId: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'orden' })
  declare order: number;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'es_enfasis' })
  declare isEmphasis: boolean;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'nota' })
  declare note: string | null;

  // Copia del objetivo de la rutina al empezar la sesión (C3.a): la sesión guía
  // aunque la rutina cambie después. NULL en ejercicios añadidos a mano.
  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'series_objetivo' })
  declare targetSets: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'reps_min' })
  declare repsMin: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'reps_max' })
  declare repsMax: number | null;

  @Column({ type: DataType.DECIMAL(7, 2), allowNull: true, field: 'peso_objetivo_kg' })
  declare targetWeightKg: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'rir_objetivo' })
  declare targetRir: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'descanso_seg' })
  declare restSeconds: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'descanso_entre_seg' })
  declare restBetweenSeconds: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'duracion_seg' })
  declare durationSeconds: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'grupo' })
  declare group: number | null;

  @Column({ type: DataType.STRING(12), allowNull: true, field: 'grupo_tipo' })
  declare groupType: 'SUPERSERIE' | 'CIRCUITO' | null;

  @BelongsTo(() => WorkoutSessionModel)
  declare session?: WorkoutSessionModel;

  @BelongsTo(() => ExerciseModel)
  declare exercise?: ExerciseModel;

  @HasMany(() => WorkoutSetModel)
  declare sets?: WorkoutSetModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
