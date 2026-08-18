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
} from "sequelize-typescript";
import { EntitlementSource } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";
import { MembershipFeatureModel } from "./membership-feature.model";

@Table({
  tableName: "entitlements",
  schema: "membership",
  underscored: true,
  timestamps: true,
})
export class EntitlementModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;
  @ForeignKey(() => MembershipFeatureModel)
  @Column({ type: DataType.UUID, field: "feature_id" })
  declare featureId: string;
  @Column({ type: DataType.STRING(24), field: "source_type" })
  declare sourceType: EntitlementSource;
  @Column({ type: DataType.UUID, field: "source_id" }) declare sourceId: string;
  @Column(DataType.STRING(20)) declare status: string;
  @Column({ type: DataType.DATE, field: "starts_at" }) declare startsAt: Date;
  @Column({ type: DataType.DATE, field: "ends_at" })
  declare endsAt: Date | null;
  @Column(DataType.JSONB) declare metadata: Record<string, unknown>;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
