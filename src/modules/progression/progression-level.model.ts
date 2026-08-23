import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import type { ProgressionAudience } from "./progression-catalog";

/** Rango de la senda. Catálogo editable por el gimnasio, no constante del código. */
@Table({
  tableName: "levels",
  schema: "progression",
  underscored: true,
  timestamps: true,
})
export class ProgressionLevelModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  /** Nulo = vale para todos los gimnasios. */
  @Column({ type: DataType.STRING(60), allowNull: true, field: "tenant_id" })
  declare tenantId: string | null;

  @Default("ANY")
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare audience: ProgressionAudience;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare tagline: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false, field: "min_points" })
  declare minPoints: number;

  @Column({ type: DataType.INTEGER, allowNull: false, field: "sort_order" })
  declare sortOrder: number;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare icon: string;

  @Column({ type: DataType.STRING(9), allowNull: false })
  declare color: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare active: boolean;

  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
