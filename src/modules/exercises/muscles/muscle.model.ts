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
} from "sequelize-typescript";
import { MuscleGroupModel } from "./muscle-group.model";

@Table({
  tableName: "muscles",
  schema: "training",
  underscored: true,
  timestamps: true,
})
export class MuscleModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(160), allowNull: false, field: "latin_name" })
  declare latinName: string;

  @ForeignKey(() => MuscleGroupModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "muscle_group_id" })
  declare muscleGroupId: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @BelongsTo(() => MuscleGroupModel)
  declare group?: MuscleGroupModel;

  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
