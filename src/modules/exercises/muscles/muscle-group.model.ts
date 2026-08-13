import {
  Column,
  CreatedAt,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { MuscleModel } from "./muscle.model";

@Table({
  tableName: "muscle_groups",
  schema: "training",
  underscored: true,
  timestamps: true,
})
export class MuscleGroupModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare region: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @HasMany(() => MuscleModel)
  declare muscles?: MuscleModel[];

  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
