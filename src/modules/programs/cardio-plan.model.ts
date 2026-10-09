import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

export const CARDIO_MODALITIES = ['CORRER', 'CAMINAR', 'BICI', 'REMO', 'ELIPTICA', 'ESCALADORA', 'NADAR', 'HIIT', 'OTRO'] as const;
export type CardioModality = (typeof CARDIO_MODALITIES)[number];

@Table({ tableName: 'cardio_plans', schema: 'training', underscored: true, timestamps: true })
export class CardioPlanModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(80), allowNull: false, field: 'nombre' })
  declare name: string;

  @Column({ type: DataType.STRING(16), allowNull: false, field: 'modalidad' })
  declare modality: CardioModality;

  @Column({ type: DataType.JSONB, allowNull: false, field: 'dias_semana' })
  declare weekdays: number[];

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'minutos_objetivo' })
  declare targetMinutes: number;

  @Column({ type: DataType.STRING(8), allowNull: false, field: 'intensidad_tipo' })
  declare intensityType: 'ZONA_FC' | 'RPE';

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'zona_objetivo' })
  declare targetZone: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'rpe_objetivo' })
  declare targetRpe: number | null;

  @Column({ type: DataType.JSONB, allowNull: true, field: 'intervalos' })
  declare intervals: { trabajoSeg: number; descansoSeg: number; rondas: number } | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'fc_reposo' })
  declare restingHeartRate: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'fc_max' })
  declare maxHeartRate: number | null;

  @Default(5)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'progresion_pct_semana' })
  declare weeklyProgressionPct: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
