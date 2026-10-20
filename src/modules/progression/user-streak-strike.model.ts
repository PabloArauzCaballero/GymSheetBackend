import {
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
import { UserModel } from '../users/user.model';

export const MONTHLY_STRIKES_BASE = 3;
export const STRIKE_POINT_COST = 150;
export const MISSED_SESSION_PENALTY = 50;

/**
 * Control mensual de strikes y penalizaciones de racha por usuario.
 *
 * Cada mes calendario el usuario dispone de 3 strikes base para perdonar faltas
 * a su plan que no se hayan repuesto dentro de la misma semana.
 *
 * Si se agotan los strikes, las faltas no repuestas rompen la racha y restan
 * 50 puntos del balance. Los mismos puntos acumulados pueden canjearse por
 * strikes adicionales a razón de 150 puntos por strike.
 */
@Table({
  tableName: 'user_streak_strikes',
  schema: 'progression',
  underscored: true,
  timestamps: true,
})
export class UserStreakStrikeModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare userId: string;

  /** Mes calendario en formato YYYY-MM (ej. '2026-10') */
  @Column({ type: DataType.STRING(7), allowNull: false, field: 'mes' })
  declare month: string;

  /** Strikes consumidos para proteger la racha tras faltas no repuestas */
  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'strikes_usados' })
  declare usedStrikes: number;

  /** Strikes adicionales comprados con puntos */
  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'strikes_comprados' })
  declare purchasedStrikes: number;

  /** Puntos penalizados por faltas no repuestas cuando no quedaban strikes */
  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'puntos_penalizados' })
  declare penaltyPoints: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;

  /** Strikes disponibles este mes */
  get availableStrikes(): number {
    return Math.max(0, MONTHLY_STRIKES_BASE + this.purchasedStrikes - this.usedStrikes);
  }
}
