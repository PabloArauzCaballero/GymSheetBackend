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
import type {
  BadgeCategory,
  BadgeCriterionType,
  BadgeRarity,
  ProgressionAudience,
} from "./progression-catalog";

/** Insignia. Catálogo editable: el gimnasio define qué premia y cuánto vale. */
@Table({
  tableName: "badges",
  schema: "progression",
  underscored: true,
  timestamps: true,
})
export class ProgressionBadgeModel extends Model {
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

  @Column({ type: DataType.STRING(300), allowNull: false })
  declare description: string;

  @Column({ type: DataType.STRING(300), allowNull: true, field: "flavor_text" })
  declare flavorText: string | null;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare category: BadgeCategory;

  @Default("COMUN")
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare rarity: BadgeRarity;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare icon: string;

  @Column({ type: DataType.STRING(9), allowNull: false })
  declare color: string;

  @Column({ type: DataType.STRING(40), allowNull: false, field: "criterion_type" })
  declare criterionType: BadgeCriterionType;

  /**
   * DECIMAL viaja como cadena en Sequelize para no perder precisión. La
   * comparación se hace en número: los umbrales son magnitudes de entrenamiento
   * (kilos, repeticiones), muy lejos del límite de un double.
   */
  @Column({
    type: DataType.DECIMAL(12, 2),
    allowNull: false,
    field: "criterion_threshold",
  })
  declare criterionThreshold: string;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: "points_reward" })
  declare pointsReward: number;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare secret: boolean;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare active: boolean;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: "sort_order" })
  declare sortOrder: number;

  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
