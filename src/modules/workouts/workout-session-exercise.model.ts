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
import { SkipReason, WorkoutSkippedSetModel } from './workout-skipped-set.model';

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

  @Column({ type: DataType.UUID, allowNull: true, field: 'routine_exercise_id' })
  declare routineExerciseId: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'planned_sets' })
  declare plannedSets: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'planned_reps_min' })
  declare plannedRepsMin: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'planned_reps_max' })
  declare plannedRepsMax: number | null;

  @Column({ type: DataType.DECIMAL(7, 2), allowNull: true, field: 'planned_weight_kg' })
  declare plannedWeightKg: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'planned_rir' })
  declare plannedRir: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'planned_rest_seconds' })
  declare plannedRestSeconds: number | null;

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

  // El ejercicio se omitió esta sesión (D1). Las series que tuviera siguen contando.
  @Column({ type: DataType.STRING(16), allowNull: true, field: 'omitido_motivo' })
  declare omittedReason: SkipReason | null;

  @Column({ type: DataType.STRING(280), allowNull: true, field: 'omitido_nota' })
  declare omittedNote: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'omitido_en' })
  declare omittedAt: Date | null;

  @HasMany(() => WorkoutSetModel)
  declare sets?: WorkoutSetModel[];

  @HasMany(() => WorkoutSkippedSetModel)
  declare skippedSets?: WorkoutSkippedSetModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
