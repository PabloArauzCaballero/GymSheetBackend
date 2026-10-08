import { Column, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

/** Ajuste de una semana concreta del programa (descarga, factores de volumen y carga). */
@Table({
  tableName: 'routine_week_overrides',
  schema: 'training',
  underscored: true,
  timestamps: false,
})
export class RoutineWeekOverrideModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'routine_id' })
  declare routineId: string;

  @PrimaryKey
  @Column({ type: DataType.SMALLINT, field: 'semana_numero' })
  declare weekNumber: number;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'es_descarga' })
  declare isDeload: boolean;

  @Default('1.00')
  @Column({ type: DataType.DECIMAL(3, 2), allowNull: false, field: 'factor_volumen' })
  declare volumeFactor: string;

  @Default('1.00')
  @Column({ type: DataType.DECIMAL(3, 2), allowNull: false, field: 'factor_carga' })
  declare loadFactor: string;

  @Column({ type: DataType.STRING(200), allowNull: true, field: 'nota' })
  declare note: string | null;
}
