import { Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";

/** Un registro append-only por vista de perfil. Nunca se borra ni se agrega en escritura. */
@Table({ tableName: "profile_views", schema: "profile", underscored: true, timestamps: false })
export class ProfileViewModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "viewer_id" })
  declare viewerId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "viewed_user_id" })
  declare viewedUserId: string;

  @Column({ type: DataType.STRING(60), allowNull: false, field: "tenant_id" })
  declare tenantId: string;

  @CreatedAt
  @Column({ field: "viewed_at" })
  declare viewedAt: Date;
}
