import { Column, DataType, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from "sequelize-typescript";
import { UserModel } from "../users/user.model";

/** Exact coordinates are stored separately and never leave the private map service. */
@Table({ tableName: "map_locations", schema: "social", underscored: true, timestamps: false })
export class SocialMapLocationModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: false })
  declare latitude: string;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: false })
  declare longitude: string;

  @Column({ type: DataType.STRING(32), allowNull: false, field: "cell_id" })
  declare cellId: string;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false, field: "updated_at" })
  declare updatedAt: Date;
}
