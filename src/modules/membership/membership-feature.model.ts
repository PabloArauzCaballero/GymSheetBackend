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

@Table({
  tableName: "features",
  schema: "membership",
  underscored: true,
  timestamps: true,
})
export class MembershipFeatureModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Column(DataType.STRING(100)) declare code: string;
  @Column(DataType.STRING(180)) declare name: string;
  @Column(DataType.TEXT) declare description: string | null;
  @Column(DataType.STRING(20)) declare status: string;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
