import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

export type ProgramLane = 'STRENGTH' | 'CARDIO';
export type ProgramMode = 'NONE' | 'PROGRESSIVE_OVERLOAD' | 'STRENGTH_GOALS' | 'CARDIO';
export type ProgramState = 'ACTIVE' | 'FINISHED' | 'STOPPED';
export type ProgramCloseReason = 'REPLACED' | 'COMPLETED' | 'USER_STOPPED' | 'REPEATED';

@Table({ tableName: 'training_programs', schema: 'training', underscored: true, timestamps: true })
export class TrainingProgramModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(10), allowNull: false, field: 'carril' })
  declare lane: ProgramLane;

  @Column({ type: DataType.STRING(24), allowNull: false, field: 'modo' })
  declare mode: ProgramMode;

  @Column({ type: DataType.UUID, allowNull: true, field: 'routine_id' })
  declare routineId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'cardio_plan_id' })
  declare cardioPlanId: string | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'assignment_id' })
  declare assignmentId: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'config' })
  declare config: Record<string, unknown>;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'fecha_inicio' })
  declare startDate: string;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'fecha_fin_prevista' })
  declare plannedEndDate: string;

  @Default('ACTIVE')
  @Column({ type: DataType.STRING(10), allowNull: false, field: 'estado' })
  declare status: ProgramState;

  @Column({ type: DataType.STRING(16), allowNull: true, field: 'motivo_cierre' })
  declare closeReason: ProgramCloseReason | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'cerrado_en' })
  declare closedAt: Date | null;

  @Default('1.00')
  @Column({ type: DataType.DECIMAL(3, 2), allowNull: false, field: 'multiplicador_actual' })
  declare multiplier: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}

@Table({ tableName: 'program_lift_targets', schema: 'training', underscored: true, timestamps: false })
export class ProgramLiftTargetModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'program_id' })
  declare programId: string;

  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'ejercicio_id' })
  declare exerciseId: string;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: false, field: 'peso_trabajo_kg' })
  declare workingWeightKg: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'reps_min' })
  declare repsMin: number;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'reps_max' })
  declare repsMax: number;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'rir_objetivo' })
  declare rirTarget: number | null;

  @Column({ type: DataType.DECIMAL(4, 2), allowNull: false, field: 'incremento_kg' })
  declare incrementKg: string;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: false, field: 'peso_sugerido_kg' })
  declare suggestedKg: string;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'fallos_seguidos' })
  declare consecutiveFails: number;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'e1rm_inicial_kg' })
  declare initialE1rmKg: string | null;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'e1rm_actual_kg' })
  declare currentE1rmKg: string | null;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'marca_meta_kg' })
  declare goalKg: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'fecha_meta' })
  declare goalDate: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'alcanzada_en' })
  declare reachedAt: Date | null;
}

@Table({ tableName: 'program_weeks', schema: 'training', underscored: true, timestamps: false })
export class ProgramWeekModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'program_id' })
  declare programId: string;

  @PrimaryKey
  @Column({ type: DataType.SMALLINT, field: 'semana_numero' })
  declare weekNumber: number;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'semana_inicio' })
  declare weekStart: string;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'es_descarga' })
  declare isDeload: boolean;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'sesiones_plan' })
  declare sessionsPlan: number;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'sesiones_hechas' })
  declare sessionsDone: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'minutos_cardio' })
  declare cardioMinutes: number;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'cumplida' })
  declare fulfilled: boolean | null;

  @Column({ type: DataType.DECIMAL(3, 2), allowNull: true, field: 'multiplicador' })
  declare multiplier: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'cerrada_en' })
  declare closedAt: Date | null;
}
